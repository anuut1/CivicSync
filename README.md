<div align="center">
  <span style="font-size: 50px;">📍</span>
  <h1>civiSync</h1>
  <p><strong>Hyperlocal Civic Issue Reporting App for Indian Cities</strong></p>
</div>

---

**civiSync** is a premium, mobile-first Web Applet designed to empower citizens in Indian cities to report, verify, and track municipal issues (like potholes, water leaks, broken streetlights, and trash piles). Built with React, Zustand, Axios, and Leaflet, the frontend integrates with a FastAPI/SQLite backend and leverages **Gemini 3.5 Flash** for automated issue analysis, predictive risk alerts, and real-time conversational assistance.

## Key Features & Highlights

### 1. Interactive Leaflet Map
* Fullscreen mapping centered on **Chennai** `[13.0827, 80.2707]` using OpenStreetMap tiles.
* Issues are rendered as circular indicators, color-coded and sized dynamically by **severity** (Green = Minor, Amber = Significant, Red = Critical).
* Clicking any marker centers the map and displays the issue details bottom sheet.

### 2. Gamified Civic Engagement
* **Report Issue Form**: Upload a local image or capture from camera. For rapid testing on desktops, citizens can select from **preset mock photos** (Pothole, Leak, Light, Trash).
* **Location Snapping**: Fetch GPS coordinates via Geolocation API, enter manually, or snap directly to the current map center.
* **Consent Upvoting**: Citizens can verify reports to build consensus. Issues auto-transition to `Verified` at 3 upvotes.
* **XP System**: Earn `+10 XP` for reports, `+5 XP` for verifications, and `+20 XP` when your reported issue is resolved.

### 3. Admin Command Dashboard
* **Crew Assignment**: Assign verified issues to municipal crews.
* **Evidence Upload**: Resolve issues by uploading proof-of-work photos.
* **Predictive Warning Alerts**: Admins can run AI-powered predictions. Gemini scans the past 30 days of reports to forecast ward infrastructure failures (low/medium/high risk warnings).
* **Ward Leaderboard**: Renders top-performing wards sorted by resolved cases, awarding gold, silver, and bronze trophies.

---

## Completed Innovations

### 🔍 Innovation B: Advanced Map Filters
* Sleek horizontal scrolling pill bar at the top of the map.
* **Category Filters**: Toggle categories on/off (`🕳️ Potholes`, `💧 Leaks`, `💡 Lights`, `🗑️ Waste`, `⚠️ Others`).
* **Status Filters**: Filter markers by lifecycle (`Pending`, `Verified`, `Assigned`, `Resolved`).
* **Resolved Issues Sync**: Toggling the `Resolved` pill automatically requests and displays archived/resolved issues from the database.

### 🤖 Innovation C: Gemini AI Chat Assistant ("civiSync Bot")
* Floating chat widget in the bottom right corner.
* Feeds real-time database state (active reports, status changes, predictive alerts) directly into the prompt context.
* Uses **Gemini 3.5 Flash** to answer natural language queries (e.g., *"Are there water leaks in Ward 3?"* or *"What warnings are active?"*) with high accuracy.
* Includes quick preset queries and offline fallback heuristics.

---

## Tech Stack

* **Frontend**: React + Vite, Zustand (State), Axios (API Client), React-Leaflet (OSM mapping), Inline Styles.
* **Backend**: FastAPI (Python), SQLite (Database), SQLAlchemy (ORM), Uvicorn (ASGI server).
* **AI Engine**: Gemini 3.5 Flash (Vision Analysis, Predictive Alerts, and Chat Assistant).

---

## Project Structure

```text
src/
  api/client.js          # Axios client with JWT interceptor
  utils/store.js         # Zustand global state store & filter actions
  components/
    IssueMap.jsx         # Fullscreen Leaflet map & MapRecenter
    ReportForm.jsx       # Geolocation form with mock presets & XP
    IssuePanel.jsx       # Detailed bottom sheet with voting & resolution proofs
    ChatBot.jsx          # Chat widget & Gemini assistant panel
  pages/
    MapPage.jsx          # Consumer map page with filter pill bar
    AdminDashboard.jsx   # Admin panel with predictive alerts & leaderboard
  App.jsx                # Custom state-based router & Quick Login persona panel
  main.jsx               # App mounting entrypoint
backend/
  main.py                # FastAPI endpoints, database models, and Gemini controllers
  requirements.txt       # Python package dependencies
```

---

## Running Locally

### 1. Start the Backend Server (Port 8000)
Navigate to the `backend/` directory:
```bash
cd backend
# Activate virtual environment
venv\Scripts\activate
# Start FastAPI server
python main.py
```
*The database tables will auto-seed with standard mock users and issues on startup.*

### 2. Start the Frontend Server (Port 3000)
Navigate to the root workspace:
```bash
# Install packages
npm install
# Launch dev server
npm run dev
```

### 3. Accessing the Application
Open [http://localhost:3000](http://localhost:3000) in your browser.

#### Preset Personas for Fast Testing:
* **Citizen Persona**: Login as `john@citizen.org` (password: `citizen`).
* **Admin Persona**: Login as `admin@civisync.org` (password: `admin`).