import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

import math
import io
import json
import urllib.request
import urllib.parse
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, status, File, UploadFile, Form, Query, APIRouter, BackgroundTasks
from fastapi.responses import Response as FastAPIResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr
from sqlalchemy import create_engine, Column, Integer, String, Float, Boolean, DateTime, ForeignKey, func
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from jose import JWTError, jwt
from passlib.context import CryptContext
from PIL import Image, ImageDraw, ImageFont
import google.generativeai as genai
import cloudinary
import cloudinary.uploader
from fastapi_mail import ConnectionConfig, FastMail, MessageSchema, MessageType
from apscheduler.schedulers.background import BackgroundScheduler

# =====================================================================
# CONFIGURATION & ENVIRONMENT SETUP
# =====================================================================
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
CLOUDINARY_CLOUD_NAME = os.getenv("CLOUDINARY_CLOUD_NAME", "")
CLOUDINARY_API_KEY = os.getenv("CLOUDINARY_API_KEY", "")
CLOUDINARY_API_SECRET = os.getenv("CLOUDINARY_API_SECRET", "")
JWT_SECRET = os.getenv("JWT_SECRET", "vibe2ship-hackathon-super-secret-key-12345!")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 1440  # 1 day

# Initialize Gemini SDK
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# Initialize Cloudinary
if CLOUDINARY_CLOUD_NAME and CLOUDINARY_API_KEY:
    cloudinary.config(
        cloud_name=CLOUDINARY_CLOUD_NAME,
        api_key=CLOUDINARY_API_KEY,
        api_secret=CLOUDINARY_API_SECRET,
        secure=True
    )

# Mail & Twilio configs
MAIL_USERNAME = os.getenv("MAIL_USERNAME", "dummy_user")
MAIL_PASSWORD = os.getenv("MAIL_PASSWORD", "dummy_pass")
MAIL_FROM = os.getenv("MAIL_FROM", "info@civisync.org")
MAIL_PORT = int(os.getenv("MAIL_PORT", 587))
MAIL_SERVER = os.getenv("MAIL_SERVER", "smtp.mailtrap.io")

mail_conf = ConnectionConfig(
    MAIL_USERNAME=MAIL_USERNAME,
    MAIL_PASSWORD=MAIL_PASSWORD,
    MAIL_FROM=MAIL_FROM,
    MAIL_PORT=MAIL_PORT,
    MAIL_SERVER=MAIL_SERVER,
    MAIL_FROM_NAME="civiSync Administration",
    MAIL_STARTTLS=True,
    MAIL_SSL_TLS=False,
    USE_CREDENTIALS=False,
    VALIDATE_CERTS=False
)

TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_WHATSAPP_FROM = os.getenv("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886")

def send_whatsapp_notification(to_phone: str, body: str):
    if not to_phone:
        return
    if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN:
        print(f"[Twilio WhatsApp Simulator] To: {to_phone} | Msg: {body}")
        return
    try:
        from twilio.rest import Client
        client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
        message = client.messages.create(
            body=body,
            from_=TWILIO_WHATSAPP_FROM,
            to=f"whatsapp:{to_phone}"
        )
        print(f"[Twilio WhatsApp Sent] SID: {message.sid}")
    except Exception as e:
        print(f"[Twilio WhatsApp Error] {e}")

async def send_escalation_email(to_email: str, subject: str, body: str, cc_email: Optional[str] = None):
    # Sends email asynchronously without failing the endpoint if SMTP configuration is dummy
    message = MessageSchema(
        subject=subject,
        recipients=[to_email],
        cc=[cc_email] if cc_email else [],
        body=body,
        subtype=MessageType.plain
    )
    fm = FastMail(mail_conf)
    try:
        await fm.send_message(message)
        print(f"[fastapi-mail] Sent email successfully to {to_email}")
    except Exception as e:
        print(f"[fastapi-mail Error] SMTP delivery skipped/failed: {e}")

# =====================================================================
# DATABASE SETUP (SQLite / Postgres)
# =====================================================================
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./civisync.db")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# =====================================================================
# DATABASE MODELS
# =====================================================================
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="citizen")  # "citizen" or "admin"
    xp = Column(Integer, default=0)
    badges = Column(String, default="[]")  # JSON string of earned badges
    rank_movement = Column(Integer, default=0)  # -1, 0, 1 for rank updates
    watchlist = Column(String, default="[]")  # JSON list of bookmarked issue IDs
    phone = Column(String, unique=True, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class Department(Base):
    __tablename__ = "departments"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    contact_email = Column(String, nullable=False)
    contact_phone = Column(String, nullable=False)
    head_name = Column(String, nullable=False)

class Issue(Base):
    __tablename__ = "issues"
    id = Column(Integer, primary_key=True, index=True)
    reporter_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    reporter_name = Column(String, default="Anonymous")
    category = Column(String, nullable=False)  # pothole, water_leak, broken_light, waste, other
    status = Column(String, default="pending")  # pending, verified, assigned, resolved
    description = Column(String, nullable=True)
    image_url = Column(String, nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    address_string = Column(String, default="Unknown Location")
    ward = Column(String, default="Unknown Ward")
    severity = Column(Integer, default=1)  # 1-5
    ai_summary = Column(String, nullable=True)
    vote_count = Column(Integer, default=0)
    verifiers = Column(String, default="[]")  # JSON list of upvoter names
    cluster_id = Column(Integer, nullable=True)
    assigned_to = Column(String, nullable=True)
    assigned_department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    ai_assignment_reason = Column(String, nullable=True)
    ai_suggestion = Column(String, nullable=True)
    resolved_image_url = Column(String, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    is_recurring = Column(Boolean, default=False)
    eta_date = Column(DateTime, nullable=True)
    resolution_rating = Column(Integer, nullable=True)  # 1-5 stars
    priority_score = Column(Integer, default=1)  # 1-10 priority score
    near_school_hospital = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    # Budget estimator
    cost_min = Column(Integer, nullable=True)
    cost_max = Column(Integer, nullable=True)
    repair_method = Column(String, nullable=True)
    estimated_hours = Column(Integer, nullable=True)
    crew_size = Column(Integer, nullable=True)
    # Before/after AI repair quality scorer
    ai_repair_score = Column(Integer, nullable=True)
    ai_repair_verdict = Column(String, nullable=True)
    ai_remaining_issues = Column(String, nullable=True)
    ai_recommendation = Column(String, nullable=True)
    needs_review = Column(Boolean, default=False)
    sla_breached = Column(Boolean, default=False)

class Comment(Base):
    __tablename__ = "comments"
    id = Column(Integer, primary_key=True, index=True)
    issue_id = Column(Integer, ForeignKey("issues.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    reporter_name = Column(String, nullable=False)
    role = Column(String, nullable=False)
    text = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class Vote(Base):
    __tablename__ = "votes"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    issue_id = Column(Integer, ForeignKey("issues.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class PredictiveAlert(Base):
    __tablename__ = "predictive_alerts"
    id = Column(Integer, primary_key=True, index=True)
    ward = Column(String, nullable=False)
    category = Column(String, nullable=False)
    risk_level = Column(String, nullable=False)  # "low", "medium", "high"
    summary = Column(String, nullable=False)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class IssueEvent(Base):
    __tablename__ = "issue_events"
    id = Column(Integer, primary_key=True, index=True)
    issue_id = Column(Integer, ForeignKey("issues.id"), nullable=False)
    event_type = Column(String, nullable=False)
    actor_role = Column(String, nullable=False)  # Citizen, Admin, System, AI
    actor_name = Column(String, nullable=False)
    content = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class CategoryConfig(Base):
    __tablename__ = "category_configs"
    id = Column(Integer, primary_key=True, index=True)
    category = Column(String, unique=True, nullable=False)
    sla_hours = Column(Integer, nullable=False)

class DailyBriefing(Base):
    __tablename__ = "daily_briefings"
    id = Column(Integer, primary_key=True, index=True)
    date = Column(String, unique=True, nullable=False) # Store YYYY-MM-DD
    content = Column(String, nullable=False)

# Create tables
Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# =====================================================================
# AUTHENTICATION HELPERS (JWT + CryptContext)
# =====================================================================
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=ALGORITHM)

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security), db: Session = Depends(get_db)) -> User:
    token = credentials.credentials
    
    # Standard email bearer fallback for direct frontend swap compatibility (john@citizen.org)
    user = db.query(User).filter(User.email == token).first()
    if user:
        return user
        
    # Attempt email matching with URL decodes
    decoded_token = urllib.parse.unquote(token)
    user = db.query(User).filter(User.email == decoded_token).first()
    if user:
        return user

    # Otherwise try decoding standard signed JWT
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email:
            user = db.query(User).filter(User.email == email).first()
            if user:
                return user
    except Exception:
        pass
        
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authorization token")

def get_admin_user(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Requires admin account privileges")
    return current_user

# =====================================================================
# SEED INITIALIZATION DATA (Ensures matching mock data on startup)
# =====================================================================
def seed_database_if_empty():
    db = SessionLocal()
    try:
        # Seed Category Configs
        if db.query(CategoryConfig).count() == 0:
            configs = [
                CategoryConfig(category="pothole", sla_hours=168),
                CategoryConfig(category="water_leak", sla_hours=24),
                CategoryConfig(category="broken_light", sla_hours=72),
                CategoryConfig(category="waste", sla_hours=48),
                CategoryConfig(category="other", sla_hours=120)
            ]
            db.add_all(configs)
            db.commit()

        # Seed Departments
        if db.query(Department).count() == 0:
            departments = [
                Department(id=1, name="Roads & Highways Department", contact_email="roads@civisync.org", contact_phone="+919840123456", head_name="Mr. Ram Kumar"),
                Department(id=2, name="Water Supply & Sewerage Board", contact_email="water@civisync.org", contact_phone="+919840123457", head_name="Mrs. Priya Raj"),
                Department(id=3, name="Electricity & Lighting Corporation", contact_email="electricity@civisync.org", contact_phone="+919840123458", head_name="Mr. Vijay Shankar"),
                Department(id=4, name="Solid Waste Management Dept", contact_email="waste@civisync.org", contact_phone="+919840123459", head_name="Mrs. Lakshmi Devi")
            ]
            db.add_all(departments)
            db.commit()

        if db.query(User).count() == 0:
            # Seed 2 standard personas
            admin_pwd = get_password_hash("admin123")
            citizen_pwd = get_password_hash("citizen123")
            
            admin = User(id=1, name="Mayor Alice", email="admin@civisync.org", password_hash=admin_pwd, role="admin", xp=150)
            citizen = User(id=2, name="John Citizen", email="john@citizen.org", password_hash=citizen_pwd, role="citizen", xp=45)
            db.add_all([admin, citizen])
            db.commit()

            # Seed initial issues matching server.ts exactly (mapped to Chennai)
            issues = [
                Issue(
                    id=1,
                    reporter_id=2,
                    reporter_name="John Citizen",
                    category="pothole",
                    status="verified",
                    description="Huge cavernous pothole right on the crosswalk.",
                    image_url="https://images.unsplash.com/photo-1515162305285-0293e4767cc2?auto=format&fit=crop&w=800&q=80",
                    latitude=13.0820,
                    longitude=80.2750,
                    ward="Downtown Ward 1",
                    severity=4,
                    ai_summary="Severe pothole posing tire blowout risk on high-traffic intersection.",
                    vote_count=3,
                    cluster_id=None,
                    created_at=datetime.utcnow() - timedelta(days=3),
                    cost_min=8000,
                    cost_max=15000,
                    repair_method="Cold patch asphalt fill",
                    estimated_hours=2,
                    crew_size=2
                ),
                Issue(
                    id=2,
                    reporter_id=2,
                    reporter_name="John Citizen",
                    category="broken_light",
                    status="pending",
                    description="The entire alley is pitch black, street light is dead.",
                    image_url="https://images.unsplash.com/photo-1508873535684-277a3cbcc4e8?auto=format&fit=crop&w=800&q=80",
                    latitude=13.0950,
                    longitude=80.2800,
                    ward="North Heights Ward 2",
                    severity=3,
                    ai_summary="Unlit public alleyway reducing safety and visibility.",
                    vote_count=1,
                    cluster_id=None,
                    created_at=datetime.utcnow() - timedelta(days=1),
                    cost_min=2000,
                    cost_max=5000,
                    repair_method="Bulb and bracket replacement",
                    estimated_hours=1,
                    crew_size=1
                ),
                Issue(
                    id=3,
                    reporter_id=2,
                    reporter_name="John Citizen",
                    category="water_leak",
                    status="assigned",
                    description="Drinking water flooding down the slope. Huge waste!",
                    image_url="https://images.unsplash.com/photo-1542013936693-8848e574047e?auto=format&fit=crop&w=800&q=80",
                    latitude=13.0750,
                    longitude=80.2450,
                    ward="West End Ward 3",
                    severity=5,
                    ai_summary="Main pipe burst releasing high-volume water stream.",
                    vote_count=5,
                    assigned_to="Water Supply & Sewerage Board",
                    assigned_department_id=2,
                    cluster_id=None,
                    created_at=datetime.utcnow() - timedelta(days=4),
                    cost_min=15000,
                    cost_max=45000,
                    repair_method="Sleeve clamp pipe burst seal",
                    estimated_hours=4,
                    crew_size=3
                ),
                Issue(
                    id=4,
                    reporter_id=2,
                    reporter_name="John Citizen",
                    category="waste",
                    status="resolved",
                    description="Piles of trash left in front of the community park.",
                    image_url="https://images.unsplash.com/photo-1611284446314-60a58ac0deb9?auto=format&fit=crop&w=800&q=80",
                    latitude=13.0850,
                    longitude=80.2650,
                    ward="Downtown Ward 1",
                    severity=2,
                    ai_summary="Uncontrolled household garbage pile outside park entrance.",
                    vote_count=3,
                    assigned_to="Solid Waste Management Dept",
                    assigned_department_id=4,
                    resolved_image_url="https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?auto=format&fit=crop&w=800&q=80",
                    resolved_at=datetime.utcnow() - timedelta(days=7),
                    cluster_id=None,
                    created_at=datetime.utcnow() - timedelta(days=7),
                    cost_min=3000,
                    cost_max=7000,
                    repair_method="Heavy compactor clearance",
                    estimated_hours=2,
                    crew_size=2,
                    ai_repair_score=8,
                    ai_repair_verdict="Excellent",
                    ai_remaining_issues="None"
                )
            ]
            db.add_all(issues)
            db.commit()

            # Seed initial timeline events
            events = [
                # Issue 1
                IssueEvent(issue_id=1, event_type="filed", actor_role="Citizen", actor_name="John Citizen", content="Issue filed: Cavernous pothole", created_at=datetime.utcnow() - timedelta(days=3)),
                IssueEvent(issue_id=1, event_type="upvote", actor_role="System", actor_name="System", content="Upvote received (running count: 1)", created_at=datetime.utcnow() - timedelta(days=2)),
                IssueEvent(issue_id=1, event_type="upvote", actor_role="System", actor_name="System", content="Upvote received (running count: 2)", created_at=datetime.utcnow() - timedelta(days=1)),
                IssueEvent(issue_id=1, event_type="upvote", actor_role="System", actor_name="System", content="Upvote received (running count: 3)", created_at=datetime.utcnow() - timedelta(hours=12)),
                IssueEvent(issue_id=1, event_type="status", actor_role="System", actor_name="System", content="Status changed to Verified", created_at=datetime.utcnow() - timedelta(hours=12)),
                
                # Issue 2
                IssueEvent(issue_id=2, event_type="filed", actor_role="Citizen", actor_name="John Citizen", content="Issue filed: Dark unlit alleyway", created_at=datetime.utcnow() - timedelta(days=1)),
                
                # Issue 3
                IssueEvent(issue_id=3, event_type="filed", actor_role="Citizen", actor_name="John Citizen", content="Issue filed: Drinking water pipe burst", created_at=datetime.utcnow() - timedelta(days=4)),
                IssueEvent(issue_id=3, event_type="status", actor_role="System", actor_name="System", content="Status changed to Verified", created_at=datetime.utcnow() - timedelta(days=3)),
                IssueEvent(issue_id=3, event_type="ai_action", actor_role="AI", actor_name="AI auto-dispatcher", content="AI auto-assigned to Water Supply & Sewerage Board — High volume pipe burst requires priority crew mobilization", created_at=datetime.utcnow() - timedelta(days=3)),
                IssueEvent(issue_id=3, event_type="assignment", actor_role="System", actor_name="System", content="Status changed to Assigned (Water Supply & Sewerage Board)", created_at=datetime.utcnow() - timedelta(days=3)),
                
                # Issue 4
                IssueEvent(issue_id=4, event_type="filed", actor_role="Citizen", actor_name="John Citizen", content="Issue filed: Trash piles by park", created_at=datetime.utcnow() - timedelta(days=7)),
                IssueEvent(issue_id=4, event_type="status", actor_role="System", actor_name="System", content="Status changed to Verified", created_at=datetime.utcnow() - timedelta(days=6)),
                IssueEvent(issue_id=4, event_type="assignment", actor_role="Admin", actor_name="Mayor Alice", content="Department assigned: Solid Waste Management Dept", created_at=datetime.utcnow() - timedelta(days=5)),
                IssueEvent(issue_id=4, event_type="proof", actor_role="Admin", actor_name="Mayor Alice", content="Resolution proof photo uploaded", created_at=datetime.utcnow() - timedelta(days=2)),
                IssueEvent(issue_id=4, event_type="status", actor_role="System", actor_name="System", content="Status changed to Resolved", created_at=datetime.utcnow() - timedelta(days=2)),
                IssueEvent(issue_id=4, event_type="ai_action", actor_role="AI", actor_name="AI repair scorer", content="AI rated repair quality as 8/10 (Excellent)", created_at=datetime.utcnow() - timedelta(days=2))
            ]
            db.add_all(events)
            db.commit()

            # Seed initial predictive alerts
            alerts = [
                PredictiveAlert(
                    id=1,
                    ward="Downtown Ward 1",
                    category="waste",
                    risk_level="medium",
                    summary="Spike in illegal littering cases triggers alert. Sanitation runs should be increased to prevent infestations.",
                    active=True
                ),
                PredictiveAlert(
                    id=2,
                    ward="West End Ward 3",
                    category="water_leak",
                    risk_level="high",
                    summary="High density of pipeline stress issues forecast. Imminent risk of structural pipeline breakage.",
                    active=True
                )
            ]
            db.add_all(alerts)
            db.commit()
            
            # Seed standard mock votes
            votes = [
                Vote(id=1, user_id=1, issue_id=1),
                Vote(id=2, user_id=2, issue_id=2)
            ]
            db.add_all(votes)
            db.commit()

    finally:
        db.close()

seed_database_if_empty()

# =====================================================================
# ALGORITHM & CLOUD INTEGRATION HELPERS
# =====================================================================
def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate geodesic distance in meters using Haversine formula."""
    R = 6371.0  # Earth radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 + 
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c * 1000.0

def unlock_badge(user, badge_name):
    try:
        badges_list = json.loads(user.badges or "[]")
    except Exception:
        badges_list = []
    if badge_name not in badges_list:
        badges_list.append(badge_name)
        user.badges = json.dumps(badges_list)

def assign_ward_by_coordinates(lat: float, lon: float) -> str:
    """Stable, exact, coordinate-matched ward calculation logic."""
    if lat > 13.09:
        return "North Heights Ward 2"
    elif lon < 80.25:
        return "West End Ward 3"
    else:
        return "Downtown Ward 1"

def reverse_geocode_ward(lat: float, lon: float) -> str:
    """Fetch municipal ward or suburb name using free OpenStreetMap Nominatim API."""
    try:
        url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=json"
        req = urllib.request.Request(url, headers={"User-Agent": "civiSyncGeocoding/1.0 (Vibe2Ship Hackathon)"})
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode())
            address = data.get("address", {})
            # Look for explicit ward attributes
            ward = address.get("ward") or address.get("suburb") or address.get("neighbourhood")
            if ward:
                return ward
    except Exception:
        pass
    # Standard stable coordinate fallback to maintain ward boundaries consistently
    return assign_ward_by_coordinates(lat, lon)

def upload_image_to_cloudinary(image_bytes: bytes) -> str:
    """Uploads file bytes to Cloudinary and returns secure URL. Falls back safely if config is missing."""
    if not CLOUDINARY_CLOUD_NAME or not CLOUDINARY_API_KEY:
        # Returns a randomized aesthetic civic-appropriate placeholder for smooth testing
        return "https://images.unsplash.com/photo-1599740831119-bab48d6cc8f7?auto=format&fit=crop&w=800&q=80"
    try:
        result = cloudinary.uploader.upload(image_bytes)
        return result.get("secure_url") or result.get("url")
    except Exception as e:
        print(f"Cloudinary upload failed: {e}")
        return "https://images.unsplash.com/photo-1599740831119-bab48d6cc8f7?auto=format&fit=crop&w=800&q=80"

# =====================================================================
# PYDANTIC SCHEMAS
# =====================================================================
class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: str = "citizen"  # "citizen" or "admin"

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict

class AssignPayload(BaseModel):
    assigned_to: str

class ChatRequest(BaseModel):
    message: str

# =====================================================================
# FASTAPI APP INITIALIZATION
# =====================================================================
app = FastAPI(title="civiSync Backend - Vibe2Ship Hackathon", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        os.getenv("FRONTEND_URL", "http://localhost:5173"),
        "http://localhost:5173",
        "http://localhost:3000",
        "https://civicsync.vercel.app",  # your Vercel URL
        "*"  # remove this after hackathon
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Setup APIRouter for both /api prefix and raw endpoints
router = APIRouter()

def get_user_activity_xp(user_id: int, days: int, db: Session) -> int:
    cutoff = datetime.utcnow() - timedelta(days=days)
    xp = 0
    
    # 1. Issues reported
    issues = db.query(Issue).filter(Issue.reporter_id == user_id, Issue.created_at >= cutoff).all()
    for issue in issues:
        earlier_issues = db.query(Issue).filter(
            Issue.ward == issue.ward, 
            Issue.created_at < issue.created_at
        ).count()
        if earlier_issues == 0:
            xp += 25
        else:
            xp += 10
            
    # 2. Votes cast
    votes_count = db.query(Vote).filter(Vote.user_id == user_id, Vote.created_at >= cutoff).count()
    xp += votes_count * 5
    
    # 3. Resolutions of reported issues
    resolved_count = db.query(Issue).filter(
        Issue.reporter_id == user_id,
        Issue.status == "resolved",
        Issue.resolved_at >= cutoff
    ).count()
    xp += resolved_count * 15
    
    return xp

@app.get("/")
def read_root():
    return {"status": "success", "message": "civiSync Backend is running"}

@app.get("/api")
def read_api_root():
    return {"status": "success", "message": "civiSync API is running"}

@router.get("/health")
def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}


# =====================================================================
# AUTH ENDPOINTS
# =====================================================================
@router.post("/auth/register", status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    existing_user = db.query(User).filter(User.email == payload.email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="User with this email is already registered")
    
    hashed_pwd = get_password_hash(payload.password)
    user_role = "admin" if payload.role.lower() == "admin" else "citizen"
    
    new_user = User(
        name=payload.name,
        email=payload.email,
        password_hash=hashed_pwd,
        role=user_role,
        xp=0
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    return {
        "id": new_user.id,
        "name": new_user.name,
        "email": new_user.email,
        "role": new_user.role,
        "xp": new_user.xp,
        "created_at": new_user.created_at
    }

@router.post("/auth/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password combination")
    
    # Return email directly as token to align with frontend fast session swap capability
    access_token = user.email
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role,
            "xp": user.xp
        }
    }

# =====================================================================
# CIVIC ISSUE ENDPOINTS
# =====================================================================
@router.post("/issues/analyze")
async def analyze_photo(
    image: UploadFile = File(...),
    description: str = Form(""),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    image_bytes = await image.read()
    
    category = "other"
    severity = "Low"
    summary = "Civic issue analyzed by AI."
    
    # Cost estimator defaults
    cost_min = 5000
    cost_max = 15000
    repair_method = "General repair"
    estimated_hours = 3
    crew_size = 2
    
    if GEMINI_API_KEY:
        try:
            pil_image = Image.open(io.BytesIO(image_bytes))
            prompt = f"""
            Analyze this civic issue photo and assess it.
            You MUST return a valid JSON object matching EXACTLY this schema:
            {{
              "category": "pothole",
              "severity": "High",
              "summary": "Pothole in middle of lane causing vehicle slow-downs."
            }}
            
            Valid categories are ONLY: "pothole", "water_leak", "broken_light", "waste", "other".
            Severity MUST be one of: "Low", "Medium", "High", "Critical".
            Summary must be a single concise sentence describing the issue in maximum 15 words.
            
            Citizen contextual input description: {description or "None"}
            """
            model = genai.GenerativeModel("gemini-1.5-flash")
            response = model.generate_content(
                [pil_image, prompt],
                generation_config={"response_mime_type": "application/json"}
            )
            
            analysis = json.loads(response.text.strip())
            category = analysis.get("category", "other").lower()
            if category not in ["pothole", "water_leak", "broken_light", "waste", "other"]:
                category = "other"
            severity = analysis.get("severity", "Low")
            if severity not in ["Low", "Medium", "High", "Critical"]:
                severity = "Low"
            summary = analysis.get("summary", "Civic issue analyzed by AI.")[:120]
            
            # Second parallel call for budget estimation
            try:
                prompt_est = f"""
                You are a municipal cost estimator for Indian cities. Based on this photo of a civic issue categorised as '{category}' with severity '{severity}', estimate the repair cost in INR and time. Reply JSON only:
                {{
                  "cost_min": integer,
                  "cost_max": integer,
                  "currency": "INR",
                  "repair_method": "string (one sentence)",
                  "estimated_hours": integer,
                  "crew_size": integer
                }}
                """
                response_est = model.generate_content(
                    [pil_image, prompt_est],
                    generation_config={"response_mime_type": "application/json"}
                )
                analysis_est = json.loads(response_est.text.strip())
                cost_min = int(analysis_est.get("cost_min", 5000))
                cost_max = int(analysis_est.get("cost_max", 15000))
                repair_method = str(analysis_est.get("repair_method", "Standard repair"))
                estimated_hours = int(analysis_est.get("estimated_hours", 2))
                crew_size = int(analysis_est.get("crew_size", 2))
            except Exception as est_err:
                print(f"Gemini estimation error: {est_err}")
        except Exception as e:
            print(f"Gemini Vision API error in analyze: {e}")
            # Robust fallback
            desc_l = description.lower()
            if "pothole" in desc_l or "road" in desc_l or "street" in desc_l:
                category = "pothole"
            elif "light" in desc_l or "dark" in desc_l or "lamp" in desc_l:
                category = "broken_light"
            elif "water" in desc_l or "leak" in desc_l or "pipe" in desc_l:
                category = "water_leak"
            elif "waste" in desc_l or "garbage" in desc_l or "trash" in desc_l:
                category = "waste"
            summary = description if description else f"Citizen reported {category} hazard."
            severity = "Medium"
    else:
        desc_l = description.lower()
        if "pothole" in desc_l or "road" in desc_l or "street" in desc_l:
            category = "pothole"
        elif "light" in desc_l or "dark" in desc_l or "lamp" in desc_l:
            category = "broken_light"
        elif "water" in desc_l or "leak" in desc_l or "pipe" in desc_l:
            category = "water_leak"
        elif "waste" in desc_l or "garbage" in desc_l or "trash" in desc_l:
            category = "waste"
        summary = description if description else f"Citizen reported {category} hazard."
        severity = "Medium"
        
    # Apply category fallbacks for local mock/no-api-key cases
    if cost_min == 5000 and cost_max == 15000:
        if category == "pothole":
            cost_min, cost_max, repair_method, estimated_hours, crew_size = 5000, 15000, "Cold patch asphalt fill", 2, 2
        elif category == "water_leak":
            cost_min, cost_max, repair_method, estimated_hours, crew_size = 15000, 45000, "Sleeve clamp pipe burst seal", 4, 3
        elif category == "broken_light":
            cost_min, cost_max, repair_method, estimated_hours, crew_size = 2000, 5000, "Bulb and bracket replacement", 1, 1
        elif category == "waste":
            cost_min, cost_max, repair_method, estimated_hours, crew_size = 3000, 7000, "Heavy compactor clearance", 2, 2
        else:
            cost_min, cost_max, repair_method, estimated_hours, crew_size = 4000, 10000, "General repair", 3, 2

    return {
        "category": category,
        "severity": severity,
        "description": summary,
        "cost_min": cost_min,
        "cost_max": cost_max,
        "repair_method": repair_method,
        "estimated_hours": estimated_hours,
        "crew_size": crew_size
    }

@router.post("/issues/report")
async def report_issue(
    image: UploadFile = File(...),
    latitude: float = Form(...),
    longitude: float = Form(...),
    description: str = Form(""),
    address_string: str = Form("Unknown Location"),
    category: str = Form("other"),
    severity: str = Form("Low"),
    cost_min: Optional[int] = Form(None),
    cost_max: Optional[int] = Form(None),
    repair_method: Optional[str] = Form(None),
    estimated_hours: Optional[int] = Form(None),
    crew_size: Optional[int] = Form(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    image_bytes = await image.read()
    ward_name = reverse_geocode_ward(latitude, longitude)
    uploaded_url = upload_image_to_cloudinary(image_bytes)
    
    category = category.lower()
    if category not in ["pothole", "water_leak", "broken_light", "waste", "other"]:
        category = "other"
        
    severity_map = {"low": 1, "medium": 2, "high": 3, "critical": 4}
    sev_int = severity_map.get(severity.lower(), 1)

    # Fallback default values for costs if not provided
    if cost_min is None:
        if category == "pothole":
            cost_min, cost_max, repair_method, estimated_hours, crew_size = 5000, 15000, "Cold patch asphalt fill", 2, 2
        elif category == "water_leak":
            cost_min, cost_max, repair_method, estimated_hours, crew_size = 15000, 45000, "Sleeve clamp pipe burst seal", 4, 3
        elif category == "broken_light":
            cost_min, cost_max, repair_method, estimated_hours, crew_size = 2000, 5000, "Bulb and bracket replacement", 1, 1
        elif category == "waste":
            cost_min, cost_max, repair_method, estimated_hours, crew_size = 3000, 7000, "Heavy compactor clearance", 2, 2
        else:
            cost_min, cost_max, repair_method, estimated_hours, crew_size = 4000, 10000, "General repair", 3, 2

    # Duplicate Detection (<= 100 meters matching category)
    cluster_id = None
    nearby_issues = db.query(Issue).filter(
        Issue.category == category,
        Issue.status != "resolved"
    ).all()
    
    for ex_issue in nearby_issues:
        dist = haversine_distance(latitude, longitude, ex_issue.latitude, ex_issue.longitude)
        if dist <= 100.0:
            if ex_issue.cluster_id:
                cluster_id = ex_issue.cluster_id
            else:
                ex_issue.cluster_id = ex_issue.id
                db.add(ex_issue)
                cluster_id = ex_issue.id
            break

    # Save to database
    new_issue = Issue(
        reporter_id=current_user.id,
        reporter_name=current_user.name,
        category=category,
        status="pending",
        description=description,
        image_url=uploaded_url,
        latitude=latitude,
        longitude=longitude,
        address_string=address_string,
        ward=ward_name,
        severity=sev_int,
        ai_summary=description or f"New {category} hazard reported",
        vote_count=0,
        cluster_id=cluster_id,
        cost_min=cost_min,
        cost_max=cost_max,
        repair_method=repair_method,
        estimated_hours=estimated_hours,
        crew_size=crew_size
    )
    db.add(new_issue)
    db.commit()
    db.refresh(new_issue)

    # Store timeline events
    event = IssueEvent(
        issue_id=new_issue.id,
        event_type="filed",
        actor_role="Citizen",
        actor_name=current_user.name,
        content=f"Issue filed: {new_issue.description or new_issue.ai_summary or 'Hazard reported'}",
        created_at=new_issue.created_at
    )
    db.add(event)

    if cluster_id is not None:
        ai_event = IssueEvent(
            issue_id=new_issue.id,
            event_type="ai_action",
            actor_role="AI",
            actor_name="AI Duplicate Finder",
            content=f"AI duplicate detected — grouped under cluster #{cluster_id}",
            created_at=new_issue.created_at
        )
        db.add(ai_event)

    # First report in ward awards +25 XP, otherwise +10 XP
    is_first_in_ward = db.query(Issue).filter(Issue.ward == ward_name, Issue.id != new_issue.id).count() == 0
    xp_award = 25 if is_first_in_ward else 10
    current_user.xp += xp_award
    
    # Unlock Badges
    unlock_badge(current_user, "First Report")
    if category == "pothole":
        unlock_badge(current_user, "Pothole Hunter")
        
    local_now = datetime.utcnow() + timedelta(hours=5.5)
    if local_now.hour >= 20 or local_now.hour < 5:
        unlock_badge(current_user, "Night Owl")
        
    seven_days_ago = datetime.utcnow() - timedelta(days=7)
    recent_count = db.query(Issue).filter(
        Issue.reporter_id == current_user.id, 
        Issue.created_at >= seven_days_ago
    ).count()
    if recent_count >= 3: # streak
        unlock_badge(current_user, "Streak")
        
    db.add(current_user)
    db.commit()
    db.refresh(new_issue)
    
    return new_issue

@router.get("/issues/map")
def get_map_issues(
    min_lat: Optional[float] = Query(None),
    max_lat: Optional[float] = Query(None),
    min_lon: Optional[float] = Query(None),
    max_lon: Optional[float] = Query(None),
    include_resolved: Optional[bool] = Query(False),
    db: Session = Depends(get_db)
):
    if include_resolved:
        query = db.query(Issue)
    else:
        query = db.query(Issue).filter(Issue.status != "resolved")
    
    if min_lat is not None:
        query = query.filter(Issue.latitude >= min_lat)
    if max_lat is not None:
        query = query.filter(Issue.latitude <= max_lat)
    if min_lon is not None:
        query = query.filter(Issue.longitude >= min_lon)
    if max_lon is not None:
        query = query.filter(Issue.longitude <= max_lon)
        
    return query.all()

@router.get("/issues/{id}")
def get_issue_by_id(id: int, db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Civic issue report not found")
    return issue

@router.post("/issues/{id}/vote")
def vote_issue(id: int, background_tasks: BackgroundTasks, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Civic issue report not found")
        
    if issue.status == "resolved":
        raise HTTPException(status_code=400, detail="Cannot upvote/verify already resolved civic issues")
        
    # Check duplicate voting
    existing_vote = db.query(Vote).filter(Vote.user_id == current_user.id, Vote.issue_id == id).first()
    if existing_vote:
        raise HTTPException(status_code=400, detail="You have already casted a verifying vote for this issue")
        
    new_vote = Vote(user_id=current_user.id, issue_id=id)
    db.add(new_vote)
    
    issue.vote_count += 1
    
    # Store upvote timeline event
    evt = IssueEvent(
        issue_id=issue.id,
        event_type="upvote",
        actor_role="System",
        actor_name="System",
        content=f"Upvote received showing running count ({issue.vote_count})",
        created_at=datetime.utcnow()
    )
    db.add(evt)
    
    if issue.vote_count >= 3 and issue.status == "pending":
        issue.status = "verified"
        status_evt = IssueEvent(
            issue_id=issue.id,
            event_type="status",
            actor_role="System",
            actor_name="System",
            content="Status changed to Verified",
            created_at=datetime.utcnow()
        )
        db.add(status_evt)
        # Trigger background auto dispatcher!
        background_tasks.add_task(run_auto_assign, issue.id, db)
        
    try:
        verifiers_list = json.loads(issue.verifiers or "[]")
    except Exception:
        verifiers_list = []
    if current_user.name not in verifiers_list:
        verifiers_list.append(current_user.name)
        issue.verifiers = json.dumps(verifiers_list)
        
    current_user.xp += 5
    db.add(current_user)
    db.add(issue)
    
    db.commit()
    db.refresh(issue)
    db.refresh(current_user)
    
    return {
        "message": "Verification vote logged successfully",
        "vote_count": issue.vote_count,
        "status": issue.status,
        "user_xp": current_user.xp
    }

@router.post("/issues/{id}/assign")
@router.patch("/issues/{id}/assign")
def assign_issue(id: int, payload: AssignPayload, current_user: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Civic issue report not found")
        
    issue.assigned_to = payload.assigned_to
    
    # Try finding department by name to link it
    dept = db.query(Department).filter(Department.name == payload.assigned_to).first()
    if dept:
        issue.assigned_department_id = dept.id
        
    issue.status = "assigned"
    
    # If eta_days is in payload, set eta_date
    if payload.eta_days:
        issue.eta_date = datetime.utcnow() + timedelta(days=payload.eta_days)
        eta_evt = IssueEvent(
            issue_id=issue.id,
            event_type="eta",
            actor_role="Admin",
            actor_name=current_user.name,
            content=f"ETA set to {payload.eta_days} days (Target: {issue.eta_date.strftime('%a %d %b, %I:%M%p')})",
            created_at=datetime.utcnow()
        )
        db.add(eta_evt)
        
    # Timeline events
    assign_evt = IssueEvent(
        issue_id=issue.id,
        event_type="assignment",
        actor_role="Admin",
        actor_name=current_user.name,
        content=f"Department assigned: {payload.assigned_to}",
        created_at=datetime.utcnow()
    )
    db.add(assign_evt)
    
    status_evt = IssueEvent(
        issue_id=issue.id,
        event_type="status",
        actor_role="System",
        actor_name="System",
        content="Status changed to Assigned",
        created_at=datetime.utcnow()
    )
    db.add(status_evt)
    
    db.add(issue)
    db.commit()
    db.refresh(issue)
    
    return issue

@router.post("/issues/{id}/resolve")
@router.patch("/issues/{id}/resolve")
async def resolve_issue(
    id: int,
    resolved_image: UploadFile = File(...),
    current_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    issue = db.query(Issue).filter(Issue.id == id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Civic issue report not found")
        
    image_bytes = await resolved_image.read()
    uploaded_url = upload_image_to_cloudinary(image_bytes)
    
    issue.status = "resolved"
    issue.resolved_image_url = uploaded_url
    issue.resolved_at = datetime.utcnow()
    db.add(issue)
    
    # Timeline events
    proof_evt = IssueEvent(
        issue_id=issue.id,
        event_type="proof",
        actor_role="Admin",
        actor_name=current_user.name,
        content="Proof photo uploaded",
        created_at=datetime.utcnow()
    )
    db.add(proof_evt)
    
    status_evt = IssueEvent(
        issue_id=issue.id,
        event_type="status",
        actor_role="System",
        actor_name="System",
        content="Status changed to Resolved",
        created_at=datetime.utcnow()
    )
    db.add(status_evt)
    
    # Before/After AI Repair Quality Scorer Comparison
    score, verdict, remaining_issues, recommendation = 8, "Excellent", None, None
    if GEMINI_API_KEY:
        try:
            req = urllib.request.Request(issue.image_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=5) as response:
                original_bytes = response.read()
            pil_orig = Image.open(io.BytesIO(original_bytes))
            pil_resolved = Image.open(io.BytesIO(image_bytes))
            
            prompt_comp = """
            Compare these two photos. The first is a civic issue (before), the second is after a municipal repair. Rate the repair quality from 0–10 where 10 means fully resolved with no trace of the problem. Return JSON only:
            {
              "score": integer,
              "verdict": "Excellent/Good/Partial/Poor",
              "remaining_issues": "string or null",
              "recommendation": "string or null"
            }
            """
            model_comp = genai.GenerativeModel("gemini-1.5-flash")
            response_comp = model_comp.generate_content(
                [pil_orig, pil_resolved, prompt_comp],
                generation_config={"response_mime_type": "application/json"}
            )
            analysis_comp = json.loads(response_comp.text.strip())
            score = int(analysis_comp.get("score", 8))
            verdict = str(analysis_comp.get("verdict", "Excellent"))
            remaining_issues = analysis_comp.get("remaining_issues")
            recommendation = analysis_comp.get("recommendation")
        except Exception as comp_err:
            print(f"Gemini comparison error: {comp_err}")
            
    issue.ai_repair_score = score
    issue.ai_repair_verdict = verdict
    issue.ai_remaining_issues = remaining_issues
    issue.ai_recommendation = recommendation
    
    # AI Action event
    ai_evt = IssueEvent(
        issue_id=issue.id,
        event_type="ai_action",
        actor_role="AI",
        actor_name="AI Repair Scorer",
        content=f"AI rated repair quality as {score}/10 ({verdict})",
        created_at=datetime.utcnow()
    )
    db.add(ai_evt)
    
    if score < 5:
        issue.needs_review = True
        review_evt = IssueEvent(
            issue_id=issue.id,
            event_type="sla_breach",
            actor_role="System",
            actor_name="System",
            content="AI flagged repair quality as Poor — supervisor review recommended",
            created_at=datetime.utcnow()
        )
        db.add(review_evt)
        
    # Reward original reporter with +15 XP and unlock Hazard Buster badge
    reporter = db.query(User).filter(User.id == issue.reporter_id).first()
    if reporter:
        reporter.xp += 15
        unlock_badge(reporter, "Hazard Buster")
        db.add(reporter)
        
    db.commit()
    db.refresh(issue)
    
    return {
        "message": "Civic issue marked as successfully resolved",
        "issue": {
            "id": issue.id,
            "status": issue.status,
            "resolved_image_url": issue.resolved_image_url,
            "ai_repair_score": issue.ai_repair_score,
            "ai_repair_verdict": issue.ai_repair_verdict,
            "needs_review": issue.needs_review
        }
    }

# =====================================================================
# PREDICTIVE AI & METRIC ENDPOINTS
# =====================================================================
@router.get("/admin/metrics")
def get_admin_metrics(current_user: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    # 1. Total issues resolved this month
    now = datetime.utcnow()
    start_of_month = datetime(now.year, now.month, 1)
    resolved_this_month = db.query(Issue).filter(
        Issue.status == "resolved",
        Issue.resolved_at >= start_of_month
    ).count()
    
    # 2. Average resolution time in hours
    resolved_issues = db.query(Issue).filter(
        Issue.status == "resolved",
        Issue.resolved_at.isnot(None)
    ).all()
    
    avg_resolution_time = 0.0
    if resolved_issues:
        total_hours = 0.0
        for issue in resolved_issues:
            diff = issue.resolved_at - issue.created_at
            total_hours += diff.total_seconds() / 3600.0
        avg_resolution_time = round(total_hours / len(resolved_issues), 1)
        
    # 3. Most active ward
    ward_counts = db.query(Issue.ward, func.count(Issue.id).label("count")).group_by(Issue.ward).all()
    most_active_ward = "None"
    if ward_counts:
        most_active_ward = max(ward_counts, key=lambda x: x[1])[0]
        
    # 4. Total verified citizen reporters
    reporters_count = db.query(func.count(func.distinct(Issue.reporter_id))).filter(
        Issue.reporter_id.in_(db.query(User.id).filter(User.role == "citizen"))
    ).scalar() or 0
    
    return {
        "resolved_this_month": resolved_this_month,
        "avg_resolution_time_hours": avg_resolution_time,
        "most_active_ward": most_active_ward,
        "total_verified_reporters": reporters_count
    }

@router.post("/alerts/run-predictions")
def run_predictions(current_user: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    recent_issues = db.query(Issue).filter(Issue.created_at >= thirty_days_ago).all()
    
    if not recent_issues:
        return {"status": "success", "alerts_created": 0, "message": "No issues in last 30 days to compute predictions"}
        
    ward_groups = {}
    for issue in recent_issues:
        if issue.ward not in ward_groups:
            ward_groups[issue.ward] = []
        ward_groups[issue.ward].append({
            "category": issue.category,
            "severity": issue.severity,
            "status": issue.status,
            "description": issue.description or ""
        })
        
    alerts_created_count = 0
    
    for ward_name, issues_list in ward_groups.items():
        risk_level = "low"
        dominant_category = "other"
        alert_needed = False
        summary_text = "Risk factors are normal in this ward."
        
        # Determine dominant category locally
        category_counts = {}
        for idx in issues_list:
            category_counts[idx["category"]] = category_counts.get(idx["category"], 0) + 1
        if category_counts:
            dominant_category = max(category_counts, key=category_counts.get)
            
        if GEMINI_API_KEY:
            try:
                issues_json_str = json.dumps(issues_list)
                prompt = f"""
                Analyze these recent local civic issues for municipal ward "{ward_name}":
                {issues_json_str}
                
                You MUST evaluate historical trends to issue dynamic risk projections.
                You MUST respond with EXACTLY a valid JSON object matching this schema:
                {{
                  "risk_level": "medium",
                  "dominant_category": "{dominant_category}",
                  "alert_needed": true,
                  "summary": "Localized concentration of reports predicts water pipe corrosion risks."
                }}
                
                Values for risk_level MUST be either: "low", "medium", or "high".
                Values for alert_needed MUST be a boolean.
                Summary MUST be 1-2 sentences, maximum 30 words forecasting future civic vulnerabilities.
                """
                model = genai.GenerativeModel("gemini-1.5-flash")
                response = model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
                
                prediction = json.loads(response.text.strip())
                risk_level = prediction.get("risk_level", "low").lower()
                if risk_level not in ["low", "medium", "high"]:
                    risk_level = "low"
                alert_needed = bool(prediction.get("alert_needed", False))
                summary_text = prediction.get("summary", f"Monitor rising civic reports in {ward_name}.")[:180]
                dominant_category = prediction.get("dominant_category", dominant_category)
            except Exception as e:
                print(f"Gemini Predictive Text Model error: {e}")
                # High reliability fallback
                cnt = len(issues_list)
                if cnt >= 4:
                    risk_level = "high"
                    alert_needed = True
                    summary_text = f"High density of active issues detects cluster risk of {dominant_category} systemic failure."
                elif cnt >= 2:
                    risk_level = "medium"
                    alert_needed = True
                    summary_text = f"Moderate growth rate in {dominant_category} reports. Maintenance review advised."
        else:
            cnt = len(issues_list)
            if cnt >= 4:
                risk_level = "high"
                alert_needed = True
                summary_text = f"High density of active issues detects cluster risk of {dominant_category} systemic failure."
            elif cnt >= 2:
                risk_level = "medium"
                alert_needed = True
                summary_text = f"Moderate growth rate in {dominant_category} reports. Maintenance review advised."
                
        # Set old alerts to inactive
        db.query(PredictiveAlert).filter(
            PredictiveAlert.ward == ward_name, 
            PredictiveAlert.active == True
        ).update({"active": False})
        
        if alert_needed:
            new_alert = PredictiveAlert(
                ward=ward_name,
                category=dominant_category,
                risk_level=risk_level,
                summary=summary_text,
                active=True
            )
            db.add(new_alert)
            alerts_created_count += 1
            
    db.commit()
    return {
        "status": "success",
        "alerts_created": alerts_created_count,
        "message": f"Successfully computed ward trend models. Generated {alerts_created_count} active warning alerts."
    }

@router.get("/alerts/active")
def get_active_alerts(db: Session = Depends(get_db)):
    alerts = db.query(PredictiveAlert).filter(PredictiveAlert.active == True).all()
    priority_map = {"high": 3, "medium": 2, "low": 1}
    sorted_alerts = sorted(alerts, key=lambda a: priority_map.get(a.risk_level.lower(), 0), reverse=True)
    return sorted_alerts

@router.get("/alerts/leaderboard")
def get_ward_leaderboard(db: Session = Depends(get_db)):
    all_issues = db.query(Issue).all()
    ward_stats = {}
    for i in all_issues:
        ward = i.ward
        if ward not in ward_stats:
            ward_stats[ward] = {"total": 0, "resolved": 0}
        ward_stats[ward]["total"] += 1
        if i.status == "resolved":
            ward_stats[ward]["resolved"] += 1
            
    leaderboard = []
    for ward, stats in ward_stats.items():
        rate = stats["resolved"] / stats["total"] if stats["total"] > 0 else 0
        leaderboard.append({
            "ward": ward,
            "resolved_count": stats["resolved"],
            "total_count": stats["total"],
            "resolution_rate": round(rate, 2)
        })
        
    leaderboard.sort(key=lambda x: x["resolution_rate"], reverse=True)
    return leaderboard

@router.get("/users/leaderboard")
def get_user_leaderboard(db: Session = Depends(get_db)):
    users = db.query(User).all()
    leaderboard = []
    for u in users:
        try:
            badges_list = json.loads(u.badges or "[]")
        except Exception:
            badges_list = []
            
        title = "Newcomer"
        if u.xp >= 150:
            title = "Ward Champion"
        elif u.xp >= 100:
            title = "Community Hero"
        elif u.xp >= 50:
            title = "Verified Citizen"
        elif u.xp >= 20:
            title = "Reporter"
            
        weekly_xp = get_user_activity_xp(u.id, 7, db)
        monthly_xp = get_user_activity_xp(u.id, 30, db)
            
        leaderboard.append({
            "id": u.id,
            "name": u.name,
            "email": u.email,
            "role": u.role,
            "xp": u.xp,
            "weekly_xp": weekly_xp,
            "monthly_xp": monthly_xp,
            "level": title,
            "badges": badges_list,
            "rank_movement": u.rank_movement or 0
        })
    return leaderboard

@router.post("/admin/compile-predictions")
def compile_predictions(current_user: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    recent_issues = db.query(Issue).filter(Issue.created_at >= thirty_days_ago).all()
    
    if len(recent_issues) == 0:
        return {
            "status": "success",
            "alerts_created": 0,
            "message": "No issues in last 30 days to calculate risk warning alerts."
        }
        
    ward_groups = {}
    for issue in recent_issues:
        if issue.ward not in ward_groups:
            ward_groups[issue.ward] = []
        ward_groups[issue.ward].append({
            "category": issue.category,
            "severity": issue.severity,
            "status": issue.status,
            "description": issue.description or ""
        })
        
    db.query(PredictiveAlert).filter(PredictiveAlert.active == True).update({"active": False})
    
    alerts_created_count = 0
    for ward_name, issues_list in ward_groups.items():
        dominant_category = "other"
        cat_counts = {}
        for i in issues_list:
            cat_counts[i["category"]] = cat_counts.get(i["category"], 0) + 1
        if cat_counts:
            dominant_category = max(cat_counts, key=cat_counts.get)
            
        risk_level = "low"
        alert_needed = False
        summary_text = "Stable ward infrastructure."
        
        avg_severity = sum(i["severity"] for i in issues_list) / len(issues_list)
        cnt = len(issues_list)
        
        if GEMINI_API_KEY:
            try:
                prompt = f"""
                Analyze these civic issue reports for ward "{ward_name}" and calculate warning risks:
                {json.dumps(issues_list)}
                
                Respond in EXACTLY this JSON schema:
                {{
                  "risk_level": "medium",
                  "dominant_category": "water_leak",
                  "alert_needed": true,
                  "summary": "Multiple pipe stress issues indicates high risk of water leak breakage."
                }}
                """
                model = genai.GenerativeModel("gemini-1.5-flash")
                response = model.generate_content(
                    prompt, 
                    generation_config={"response_mime_type": "application/json"}
                )
                analysis = json.loads(response.text.strip())
                risk_level = analysis.get("risk_level", "low").lower()
                dominant_category = analysis.get("dominant_category", dominant_category)
                alert_needed = bool(analysis.get("alert_needed", False))
                summary_text = analysis.get("summary", "Periodic checks needed.")
            except Exception as e:
                print(f"Gemini admin compile predictions error: {e}")
                if cnt >= 4 or avg_severity >= 4:
                    risk_level = "high"
                    alert_needed = True
                    summary_text = f"High density of {dominant_category} reports predicts infrastructure failure risk."
                elif cnt >= 2:
                    risk_level = "medium"
                    alert_needed = True
                    summary_text = f"Moderate frequency of {dominant_category} complaints. Inspect ward pipeline."
        else:
            if cnt >= 4 or avg_severity >= 4:
                risk_level = "high"
                alert_needed = True
                summary_text = f"High concentration of reported {dominant_category} problems warning risk."
            elif cnt >= 2:
                risk_level = "medium"
                alert_needed = True
                summary_text = f"Spike in reported {dominant_category} issues. Periodic checks suggested."
                
        if alert_needed:
            new_alert = PredictiveAlert(
                ward=ward_name,
                category=dominant_category,
                risk_level=risk_level,
                summary=summary_text,
                active=True
            )
            db.add(new_alert)
            alerts_created_count += 1
            
    db.commit()
    return {
        "status": "success",
        "alerts_created": alerts_created_count,
        "message": f"Compiled trend risks. Created {alerts_created_count} warning alerts."
    }

@router.post("/chat")
def chat_assistant(payload: ChatRequest, db: Session = Depends(get_db)):
    # Fetch issues and warnings context
    issues = db.query(Issue).all()
    alerts = db.query(PredictiveAlert).filter(PredictiveAlert.active == True).all()

    issues_summary = []
    for i in issues:
        issues_summary.append({
            "id": i.id,
            "category": i.category,
            "status": i.status,
            "ward": i.ward,
            "severity": i.severity,
            "summary": i.ai_summary or i.description or "",
            "votes": i.vote_count
        })

    alerts_summary = []
    for a in alerts:
        alerts_summary.append({
            "ward": a.ward,
            "category": a.category,
            "risk": a.risk_level,
            "summary": a.summary
        })

    context = f"""
    You are "civiSync Bot", an intelligent AI civic assistant for municipal wards in Indian cities.
    Here is the current real-time database state of civic issues and predictive warning alerts in the city:

    ISSUES REPORTED BY CITIZENS:
    {json.dumps(issues_summary, indent=2)}

    ACTIVE PREDICTIVE ALERTS:
    {json.dumps(alerts_summary, indent=2)}

    Respond to the user's query: "{payload.message}".
    Be helpful, concise (maximum 3-4 sentences), and friendly.
    Always refer to the real-time issues and alerts provided above to give specific numbers, locations, or status updates when answering.
    If a user asks how to report an issue, explain that they can click the floating "+" button on the map.
    """

    if GEMINI_API_KEY:
        try:
            model = genai.GenerativeModel("gemini-1.5-flash")
            response = model.generate_content(context)
            return {"response": response.text.strip()}
        except Exception as e:
            print(f"Gemini Chat Bot API error: {e}")
            return {"response": "Sorry, I am having trouble connecting to my brain right now. Can you try again later?"}
    else:
        # Fallback local heuristics responses
        msg = payload.message.lower()
        if "pothole" in msg or "road" in msg:
            potholes_cnt = sum(1 for i in issues_summary if i["category"] == "pothole")
            return {"response": f"civiSync Bot here! I currently see {potholes_cnt} active pothole issues in the database. Please use the map to explore details or report one using the '+' button."}
        elif "water" in msg or "leak" in msg:
            leaks_cnt = sum(1 for i in issues_summary if i["category"] == "water_leak")
            return {"response": f"civiSync Bot here! There are currently {leaks_cnt} water leakage complaints active. Our teams are monitoring these!"}
        elif "alert" in msg or "warning" in msg or "predict" in msg:
            alerts_cnt = len(alerts_summary)
            return {"response": f"I see {alerts_cnt} active predictive risk warnings flagged. High-risk alerts should be audited by admins in the dashboard."}
        else:
            return {"response": "Hello! I am civiSync Bot, your civic assistant. I can help you monitor reported potholes, water leaks, streetlights, or waste warnings. What would you like to know?"}

# =====================================================================
# ADDED CIVIC APP HIGH-IMPACT IMPLEMENTATIONS & ROUTERS
# =====================================================================
import base64

async def run_auto_assign(issue_id: int, db: Session):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        return
    
    depts = db.query(Department).all()
    dept_list = ", ".join([f"{d.id}: {d.name}" for d in depts])
    
    confidence = "low"
    dept_id = None
    dept_name = ""
    reason = "Unable to determine department cleanly."
    
    if GEMINI_API_KEY:
        try:
            prompt = f"An issue has been filed with category '{issue.category}', description '{issue.description or issue.ai_summary}', and location '{issue.address_string}'. Available departments: {dept_list}. Which department should handle this? Reply JSON only: {{'department_id': int, 'department_name': string, 'confidence': 'high'/'medium'/'low', 'reason': string (one sentence)}}"
            model = genai.GenerativeModel("gemini-1.5-flash")
            response = model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
            res_json = json.loads(response.text.strip())
            confidence = res_json.get("confidence", "low").lower()
            dept_id = res_json.get("department_id")
            dept_name = res_json.get("department_name", "")
            reason = res_json.get("reason", "")
        except Exception as e:
            print(f"Gemini auto dispatch error: {e}")
            confidence = "high"
            if issue.category == "pothole":
                dept_id, dept_name, reason = 1, "Roads & Highways Department", "Pothole repair falls under road maintenance."
            elif issue.category == "water_leak":
                dept_id, dept_name, reason = 2, "Water Supply & Sewerage Board", "Water leak calls for pipeline plumbing."
            elif issue.category == "broken_light":
                dept_id, dept_name, reason = 3, "Electricity & Lighting Corporation", "Alley light needs electrical crew swap."
            elif issue.category == "waste":
                dept_id, dept_name, reason = 4, "Solid Waste Management Dept", "Park trash accumulation requires sanitation cleanup."
    else:
        confidence = "high"
        if issue.category == "pothole":
            dept_id, dept_name, reason = 1, "Roads & Highways Department", "Pothole repair falls under road maintenance."
        elif issue.category == "water_leak":
            dept_id, dept_name, reason = 2, "Water Supply & Sewerage Board", "Water leak calls for pipeline plumbing."
        elif issue.category == "broken_light":
            dept_id, dept_name, reason = 3, "Electricity & Lighting Corporation", "Alley light needs electrical crew swap."
        elif issue.category == "waste":
            dept_id, dept_name, reason = 4, "Solid Waste Management Dept", "Park trash accumulation requires sanitation cleanup."

    if confidence == "high" and dept_id:
        issue.assigned_department_id = dept_id
        issue.assigned_to = dept_name
        issue.status = "assigned"
        issue.ai_assignment_reason = f"AI auto-dispatched: {reason}"
        
        # Timeline event
        evt = IssueEvent(
            issue_id=issue.id,
            event_type="ai_action",
            actor_role="AI",
            actor_name="AI Auto-Dispatcher",
            content=f"AI auto-assigned to {dept_name} — {reason}",
            created_at=datetime.utcnow()
        )
        db.add(evt)
        # Notify
        reporter = db.query(User).filter(User.id == issue.reporter_id).first()
        if reporter and reporter.phone:
            send_whatsapp_notification(
                reporter.phone,
                f"Your issue #{issue.id} has been auto-assigned to {dept_name}."
            )
    elif confidence == "medium" and dept_name:
        issue.ai_suggestion = f"{dept_name} — {reason}"
    
    db.commit()

@router.get("/issues/{id}/events")
def get_issue_events(id: int, db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
        
    events_db = db.query(IssueEvent).filter(IssueEvent.issue_id == id).all()
    comments_db = db.query(Comment).filter(Comment.issue_id == id).all()
    
    timeline = []
    # Map issue events
    for e in events_db:
        timeline.append({
            "id": f"e{e.id}",
            "issue_id": e.issue_id,
            "event_type": e.event_type,
            "actor_role": e.actor_role,
            "actor_name": e.actor_name,
            "content": e.content,
            "created_at": e.created_at
        })
        
    # Map comments as timeline events
    for c in comments_db:
        timeline.append({
            "id": f"c{c.id}",
            "issue_id": c.issue_id,
            "event_type": "comment",
            "actor_role": c.role.capitalize(),
            "actor_name": c.reporter_name,
            "content": c.text,
            "created_at": c.created_at
        })
        
    # Sort timeline by created_at
    timeline.sort(key=lambda x: x["created_at"])
    
    # If comments > 3, call Gemini for AI summary
    ai_summary_text = None
    if len(comments_db) > 3:
        comment_texts = "\n".join([f"{c.reporter_name} ({c.role}): {c.text}" for c in comments_db])
        if GEMINI_API_KEY:
            try:
                prompt = f"Summarize these citizen/admin comments on a civic issue report. Respond with a single concise sentence under 15 words beginning with 'AI summary:':\n{comment_texts}"
                model = genai.GenerativeModel("gemini-1.5-flash")
                response = model.generate_content(prompt)
                ai_summary_text = response.text.strip()
                if not ai_summary_text.startswith("AI summary:"):
                    ai_summary_text = f"AI summary: {ai_summary_text}"
            except Exception as e:
                print(f"Gemini comment summary error: {e}")
                ai_summary_text = "AI summary: High discussion volume. Citizens and admins are active on this repair card."
        else:
            ai_summary_text = "AI summary: Multiple comments discuss coordination of repair crews and confirmation of details."
            
    # Format dates
    formatted_timeline = []
    for t in timeline:
        formatted_timeline.append({
            **t,
            "created_at": t["created_at"].isoformat()
        })
        
    if ai_summary_text:
        summary_row = {
            "id": "ai-summary",
            "issue_id": id,
            "event_type": "ai_summary",
            "actor_role": "AI",
            "actor_name": "AI Summarizer",
            "content": ai_summary_text,
            "created_at": (timeline[0]["created_at"] - timedelta(seconds=1)).isoformat() if timeline else datetime.utcnow().isoformat()
        }
        formatted_timeline.insert(0, summary_row)
        
    return formatted_timeline

class ChatIntentResponse(BaseModel):
    has_spatial_intent: bool
    category: Optional[str]
    status: Optional[str]
    severity: Optional[str]
    area_name: Optional[str]
    proximity: Optional[str]
    days_filter: Optional[int]

@router.post("/chat/intent", response_model=ChatIntentResponse)
def extract_chat_intent(payload: ChatRequest):
    has_spatial_intent = False
    category = None
    status = None
    severity = None
    area_name = None
    proximity = None
    days_filter = None
    
    if GEMINI_API_KEY:
        try:
            prompt = f"Extract spatial filter intent from this civic app query. Return JSON only, no prose: {{has_spatial_intent: boolean, category: string or null (one of Pothole/Leak/Streetlight/Waste/Other/null), status: string or null (Pending/Verified/Assigned/Resolved/null), severity: string or null (Low/Medium/High/Critical/null), area_name: string or null, proximity: string or null (near schools/near hospitals/etc), days_filter: integer or null}}. Query: '{payload.message}'"
            model = genai.GenerativeModel("gemini-1.5-flash")
            response = model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
            res_json = json.loads(response.text.strip())
            has_spatial_intent = bool(res_json.get("has_spatial_intent", False))
            category = res_json.get("category")
            status = res_json.get("status")
            severity = res_json.get("severity")
            area_name = res_json.get("area_name")
            proximity = res_json.get("proximity")
            days_filter = res_json.get("days_filter")
        except Exception as e:
            print(f"Gemini intent extraction error: {e}")
            
    if not has_spatial_intent:
        msg = payload.message.lower()
        if "near" in msg or "potholes in" in msg or "critical" in msg or "unresolved" in msg or "leaks in" in msg:
            has_spatial_intent = True
            if "pothole" in msg:
                category = "Pothole"
            elif "leak" in msg or "water" in msg:
                category = "Leak"
            if "critical" in msg:
                severity = "Critical"
            if "unresolved" in msg or "pending" in msg:
                status = "Pending"
            if "t nagar" in msg:
                area_name = "T Nagar"
            elif "anna nagar" in msg:
                area_name = "Anna Nagar"
            elif "schools" in msg:
                proximity = "near schools"
            elif "hospitals" in msg:
                proximity = "near hospitals"
                
    return {
        "has_spatial_intent": has_spatial_intent,
        "category": category,
        "status": status,
        "severity": severity,
        "area_name": area_name,
        "proximity": proximity,
        "days_filter": days_filter
    }

@router.post("/issues/{id}/auto-assign")
async def trigger_auto_assign(id: int, db: Session = Depends(get_db)):
    await run_auto_assign(id, db)
    return {"status": "success", "message": "AI Auto-assignment task executed"}

@router.post("/issues/{id}/escalate")
async def escalate_issue(id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
        
    councillor_email = f"councillor.{issue.ward.lower().replace(' ', '_')}@civisync.org"
    draft_body = f"Dear Ward Councillor,\n\nI am writing to escalate an unresolved civic issue in our ward. The committed resolution time for category '{issue.category}' has been breached.\n\nIssue Details:\n- ID: #{issue.id}\n- Description: {issue.description or issue.ai_summary}\n- Location: {issue.address_string}\n- Severity: {issue.severity}\n\nPlease take immediate action.\n\nSincerely,\n{current_user.name}"
    
    if GEMINI_API_KEY:
        try:
            prompt = f"Write a formal escalation email from a citizen to a ward councillor regarding an overdue civic issue: category '{issue.category}', description '{issue.description or issue.ai_summary}', location '{issue.address_string}', overdue by several days. Tone: firm, polite, official. Format: subject, dear councillor, body, sincerely."
            model = genai.GenerativeModel("gemini-1.5-flash")
            response = model.generate_content(prompt)
            draft_body = response.text.strip()
        except Exception as e:
            print(f"Gemini escalation email draft error: {e}")
            
    subject = f"Escalation of Overdue Civic Issue: #{issue.id} ({issue.category.upper()})"
    await send_escalation_email(
        to_email=councillor_email,
        subject=subject,
        body=draft_body,
        cc_email=current_user.email
    )
    
    # Add timeline event
    evt = IssueEvent(
        issue_id=issue.id,
        event_type="sla_breach",
        actor_role="Citizen",
        actor_name=current_user.name,
        content=f"Issue formally escalated to Ward Councillor ({councillor_email})",
        created_at=datetime.utcnow()
    )
    db.add(evt)
    db.commit()
    
    return {"status": "success", "message": f"Escalation email sent to {councillor_email} and CC'd to you."}

@router.get("/issues/{id}/share-card")
def get_share_card(id: int, db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
        
    card = Image.new("RGB", (1080, 566), "#ffffff")
    draw = ImageDraw.Draw(card)
    
    img_header = None
    if issue.image_url:
        try:
            if issue.image_url.startswith("data:image"):
                header_data = issue.image_url.split(",")[1]
                header_bytes = base64.b64decode(header_data)
                img_header = Image.open(io.BytesIO(header_bytes))
            else:
                req = urllib.request.Request(issue.image_url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=5) as response:
                    img_header = Image.open(io.BytesIO(response.read()))
        except Exception as e:
            print(f"Error fetching share-card header photo: {e}")
            
    if not img_header:
        img_header = Image.new("RGB", (1080, 280), "#1e293b")
        d_p = ImageDraw.Draw(img_header)
        d_p.text((540, 140), f"civiSync Report #{issue.id}", fill="#ffffff", anchor="mm")
        
    img_header = img_header.resize((1080, 280), Image.Resampling.LANCZOS)
    card.paste(img_header, (0, 0))
    
    draw.rectangle([(0, 280), (1080, 566)], fill="#ffffff")
    
    cat_name = issue.category.upper().replace("_", " ")
    draw.text((40, 310), f"civiSync Report #{issue.id} • {cat_name}", fill="#16a34a")
    
    address = issue.address_string if len(issue.address_string) < 60 else f"{issue.address_string[:57]}..."
    draw.text((40, 360), f"Location: {address}", fill="#1e293b")
    
    sev_lbl = {1: "Minor", 2: "Moderate", 3: "Significant", 4: "Severe", 5: "Critical"}.get(issue.severity, "Medium")
    draw.text((40, 410), f"Severity: {sev_lbl}   |   Ward: {issue.ward}", fill="#475569")
    draw.text((40, 460), f"Status: {issue.status.upper()}   |   Upvotes: {issue.vote_count}", fill="#475569")
    draw.text((900, 500), "civisync.app", fill="#94a3b8")
    
    img_bytes = io.BytesIO()
    card.save(img_bytes, format="PNG")
    img_bytes.seek(0)
    
    return FastAPIResponse(content=img_bytes.read(), media_type="image/png")

@router.get("/admin/briefings")
def get_briefings(current_user: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    return db.query(DailyBriefing).order_by(DailyBriefing.date.desc()).limit(7).all()

@router.get("/public/metrics")
def get_public_metrics(db: Session = Depends(get_db)):
    now = datetime.utcnow()
    start_of_month = datetime(now.year, now.month, 1)
    filed_this_month = db.query(Issue).filter(Issue.created_at >= start_of_month).count()
    
    total_issues = db.query(Issue).count()
    resolved_issues = db.query(Issue).filter(Issue.status == "resolved").count()
    res_rate = round((resolved_issues / total_issues * 100), 1) if total_issues > 0 else 74.0
    
    resolved_list = db.query(Issue).filter(Issue.status == "resolved", Issue.resolved_at.isnot(None)).all()
    avg_days = 2.4
    if resolved_list:
        total_days = sum([(i.resolved_at - i.created_at).total_seconds() / 86400.0 for i in resolved_list])
        avg_days = round(total_days / len(resolved_list), 1)
        
    avg_rating = db.query(func.avg(Issue.resolution_rating)).filter(Issue.resolution_rating.isnot(None)).scalar()
    avg_rating = round(float(avg_rating), 1) if avg_rating is not None else 4.2
    
    return {
        "filed_this_month": filed_this_month,
        "resolution_rate": res_rate,
        "avg_resolution_time_days": avg_days,
        "citizen_satisfaction": avg_rating
    }

@router.get("/public/wards")
def get_public_wards(db: Session = Depends(get_db)):
    all_issues = db.query(Issue).all()
    ward_stats = {}
    for i in all_issues:
        ward = i.ward
        if ward not in ward_stats:
            ward_stats[ward] = {"total": 0, "resolved": 0, "total_days": 0.0, "total_rating": 0.0, "rating_count": 0}
        ward_stats[ward]["total"] += 1
        if i.status == "resolved":
            ward_stats[ward]["resolved"] += 1
            if i.resolved_at:
                ward_stats[ward]["total_days"] += (i.resolved_at - i.created_at).total_seconds() / 86400.0
            if i.resolution_rating:
                ward_stats[ward]["total_rating"] += i.resolution_rating
                ward_stats[ward]["rating_count"] += 1
                
    leaderboard = []
    for ward, stats in ward_stats.items():
        res_rate = (stats["resolved"] / stats["total"] * 100) if stats["total"] > 0 else 0.0
        avg_days = (stats["total_days"] / stats["resolved"]) if stats["resolved"] > 0 else 0.0
        avg_rating = (stats["total_rating"] / stats["rating_count"]) if stats["rating_count"] > 0 else 0.0
        
        health_score = round((res_rate * 0.6) + ((avg_rating / 5 * 100) * 0.4)) if stats["total"] > 0 else 70
        if health_score == 0:
            health_score = 50
            
        leaderboard.append({
            "ward": ward,
            "issues_filed": stats["total"],
            "resolution_rate": round(res_rate, 1),
            "avg_days_to_resolve": round(avg_days, 1),
            "citizen_rating": round(avg_rating, 1) if avg_rating > 0 else 4.0,
            "health_score": health_score,
            "trend": "up" if health_score >= 60 else "down"
        })
        
    leaderboard.sort(key=lambda x: x["health_score"])
    return leaderboard

@router.get("/public/departments")
def get_public_departments(db: Session = Depends(get_db)):
    depts = db.query(Department).all()
    leaderboard = []
    for d in depts:
        issues = db.query(Issue).filter(Issue.assigned_department_id == d.id).all()
        assigned = len(issues)
        resolved = sum([1 for i in issues if i.status == "resolved"])
        
        total_days = 0.0
        total_rating = 0.0
        rating_count = 0
        penalty = 0
        for i in issues:
            if i.status == "resolved" and i.resolved_at:
                total_days += (i.resolved_at - i.created_at).total_seconds() / 86400.0
                if i.resolution_rating:
                    total_rating += i.resolution_rating
                    rating_count += 1
            if i.ai_repair_score is not None and i.ai_repair_score < 5:
                penalty += 10
                
        res_rate = (resolved / assigned * 100) if assigned > 0 else 75.0
        avg_days = (total_days / resolved) if resolved > 0 else 2.5
        avg_rating = (total_rating / rating_count) if rating_count > 0 else 4.2
        
        raw_score = (res_rate * 0.6) + ((avg_rating / 5 * 100) * 0.4)
        acc_score = max(0, min(100, round(raw_score - penalty))) if assigned > 0 else 75
        
        leaderboard.append({
            "id": d.id,
            "name": d.name,
            "head_name": d.head_name,
            "issues_assigned": assigned,
            "issues_resolved": resolved,
            "resolution_rate": round(res_rate, 1),
            "avg_days_to_resolve": round(avg_days, 1),
            "citizen_rating": round(avg_rating, 1),
            "accountability_score": acc_score,
            "trend": "up" if acc_score >= 50 else "down"
        })
        
    return leaderboard

@router.get("/departments")
def list_departments(db: Session = Depends(get_db)):
    return db.query(Department).all()

class RatePayload(BaseModel):
    rating: int

@router.post("/issues/{id}/rate")
def rate_issue(id: int, payload: RatePayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    issue.resolution_rating = payload.rating
    
    # Rating event
    evt = IssueEvent(
        issue_id=issue.id,
        event_type="rating",
        actor_role="Citizen",
        actor_name=current_user.name,
        content=f"Citizen rating submitted showing {payload.rating} stars",
        created_at=datetime.utcnow()
    )
    db.add(evt)
    db.commit()
    return {"status": "success", "message": "Rating saved successfully"}

# SLA and scheduler runners
def check_sla_breaches():
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        active_issues = db.query(Issue).filter(Issue.status != "resolved", Issue.sla_breached == False).all()
        for issue in active_issues:
            cfg = db.query(CategoryConfig).filter(CategoryConfig.category == issue.category).first()
            sla_hours = cfg.sla_hours if cfg else 72
            deadline = issue.created_at + timedelta(hours=sla_hours)
            if now > deadline:
                issue.sla_breached = True
                breach_hours = int((now - deadline).total_seconds() / 3600)
                
                evt = IssueEvent(
                    issue_id=issue.id,
                    event_type="sla_breach",
                    actor_role="System",
                    actor_name="System",
                    content=f"SLA breached — issue overdue by {breach_hours} hours",
                    created_at=now
                )
                db.add(evt)
                
                reporter = db.query(User).filter(User.id == issue.reporter_id).first()
                if reporter and reporter.phone:
                    send_whatsapp_notification(
                        reporter.phone,
                        f"Your issue #{issue.id} is overdue. The committed fix time was {sla_hours // 24} days."
                    )
                
                if issue.assigned_department_id:
                    dept = db.query(Department).filter(Department.id == issue.assigned_department_id).first()
                    if dept:
                        import asyncio
                        try:
                            subject = f"Escalation: SLA Breach on Issue #{issue.id}"
                            body = f"Dear {dept.head_name},\n\nIssue #{issue.id} ({issue.category}) assigned to your department has breached its SLA of {sla_hours} hours. Please resolve it immediately."
                            asyncio.run(send_escalation_email(dept.contact_email, subject, body))
                        except Exception as loop_err:
                            print(f"Error running email in scheduler: {loop_err}")
        db.commit()
    except Exception as e:
        print(f"SLA breach audit error: {e}")
    finally:
        db.close()

def generate_morning_briefing():
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        yesterday = now - timedelta(days=1)
        
        new_count = db.query(Issue).filter(Issue.created_at >= yesterday).count()
        breached_count = db.query(Issue).filter(Issue.sla_breached == True, Issue.created_at >= yesterday).count()
        top_priorities = db.query(Issue).filter(Issue.status != "resolved").order_by(Issue.priority_score.desc()).limit(3).all()
        
        priority_desc = ", ".join([f"#{i.id} (Score: {i.priority_score})" for i in top_priorities])
        
        briefing_json = {
            "new_issues_filed": new_count,
            "sla_breaches": breached_count,
            "top_priorities": priority_desc
        }
        
        content = "civiSync Morning Briefing: Wards are stable. No SLA breaches or anomalies overnight."
        if GEMINI_API_KEY:
            try:
                prompt = f"Write a concise morning briefing for a municipal admin. Tone: direct, factual, no fluff. Format: one paragraph summary, then a bullet list of 3–5 action items sorted by urgency. Data: {json.dumps(briefing_json)}"
                model = genai.GenerativeModel("gemini-1.5-flash")
                response = model.generate_content(prompt)
                content = response.text.strip()
            except Exception as gem_err:
                print(f"Briefing generation error: {gem_err}")
                
        date_str = now.strftime("%Y-%m-%d")
        existing = db.query(DailyBriefing).filter(DailyBriefing.date == date_str).first()
        if existing:
            existing.content = content
        else:
            briefing = DailyBriefing(date=date_str, content=content)
            db.add(briefing)
            
        db.commit()
        
        admins = db.query(User).filter(User.role == "admin").all()
        for admin in admins:
            if admin.phone:
                send_whatsapp_notification(admin.phone, f"Good morning! Here is today's civiSync briefing:\n\n{content}")
                
    except Exception as e:
        print(f"Briefing cron error: {e}")
    finally:
        db.close()

def check_weekly_accountability():
    db = SessionLocal()
    try:
        depts = db.query(Department).all()
        for d in depts:
            issues = db.query(Issue).filter(Issue.assigned_department_id == d.id).all()
            assigned = len(issues)
            resolved = sum([1 for i in issues if i.status == "resolved"])
            
            total_rating = sum([i.resolution_rating for i in issues if i.status == "resolved" and i.resolution_rating])
            rating_count = sum([1 for i in issues if i.status == "resolved" and i.resolution_rating])
            
            res_rate = (resolved / assigned) if assigned > 0 else 0.75
            avg_rating = (total_rating / rating_count) if rating_count > 0 else 4.0
            
            score = round((res_rate * 60) + ((avg_rating / 5) * 40))
            if score < 40:
                overdue = db.query(Issue).filter(Issue.assigned_department_id == d.id, Issue.sla_breached == True).count()
                import asyncio
                subject = f"Urgent: Weekly Accountability score warning ({score}/100)"
                body = f"Dear {d.head_name},\n\nyour department's civiSync accountability score this week is {score}/100. {overdue} issues are overdue. Login to review: http://localhost:3000/admin"
                try:
                    asyncio.run(send_escalation_email(d.contact_email, subject, body))
                except Exception as mail_err:
                    print(f"Failed to send weekly warning: {mail_err}")
    except Exception as e:
        print(f"Accountability check error: {e}")
    finally:
        db.close()

class CommentPayload(BaseModel):
    text: str

@router.post("/issues/{id}/comment")
def post_comment(id: int, payload: CommentPayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
        
    comment = Comment(
        issue_id=id,
        user_id=current_user.id,
        reporter_name=current_user.name,
        role=current_user.role,
        text=payload.text
    )
    db.add(comment)
    
    evt = IssueEvent(
        issue_id=id,
        event_type="comment_posted",
        actor_role=current_user.role.capitalize(),
        actor_name=current_user.name,
        content=f"Comment posted: {payload.text}",
        created_at=datetime.utcnow()
    )
    db.add(evt)
    db.commit()
    return {"status": "success", "message": "Comment posted successfully"}

@router.post("/admin/run-sla-check")
def run_sla_check_manual(current_user: User = Depends(get_admin_user)):
    check_sla_breaches()
    return {"status": "success", "message": "Manual SLA breach check completed"}

@router.post("/admin/run-briefing")
def run_briefing_manual(current_user: User = Depends(get_admin_user)):
    generate_morning_briefing()
    return {"status": "success", "message": "Manual briefing generation completed"}

# Setup background scheduler
scheduler = BackgroundScheduler()
scheduler.add_job(check_sla_breaches, 'interval', hours=1)
scheduler.add_job(generate_morning_briefing, 'cron', hour=7, minute=0)
scheduler.add_job(check_weekly_accountability, 'cron', day_of_week='mon', hour=9, minute=0)
scheduler.start()

# Include routes with and without /api prefix for ultimate versatility
app.include_router(router, prefix="/api")
app.include_router(router)

# =====================================================================
# LAUNCH DEV SERVER (if run directly)
# =====================================================================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
