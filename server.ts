import express, { Request, Response } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import net from "net";
import http from "http";


const app = express();
const PORT = 3000;

// Set up storage for uploaded files in memory
const upload = multer({ storage: multer.memoryStorage() });

// =====================================================================
// PERSISTENT DATA STORE (JSON File Database)
// =====================================================================
const DATA_FILE = path.join(process.cwd(), "db_store.json");

interface User {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: "citizen" | "admin";
  xp: number;
  created_at: string;
}

interface Issue {
  id: number;
  reporter_id: number;
  category: "pothole" | "water_leak" | "broken_light" | "waste" | "other";
  status: "pending" | "verified" | "assigned" | "resolved";
  description: string;
  image_url: string;
  latitude: number;
  longitude: number;
  ward: string;
  severity: number;
  ai_summary: string;
  vote_count: number;
  cluster_id: number | null;
  assigned_to: string | null;
  resolved_image_url: string | null;
  created_at: string;
}

interface Vote {
  id: number;
  user_id: number;
  issue_id: number;
  created_at: string;
}

interface PredictiveAlert {
  id: number;
  ward: string;
  category: string;
  risk_level: "low" | "medium" | "high";
  summary: string;
  active: boolean;
  created_at: string;
}

interface DB {
  users: User[];
  issues: Issue[];
  votes: Vote[];
  alerts: PredictiveAlert[];
}

const defaultDB: DB = {
  users: [
    {
      id: 1,
      name: "Mayor Alice",
      email: "admin@civisync.org",
      password_hash: "$2b$12$AdminHashedPasswordFake12345",
      role: "admin",
      xp: 150,
      created_at: new Date().toISOString(),
    },
    {
      id: 2,
      name: "John Citizen",
      email: "john@citizen.org",
      password_hash: "$2b$12$CitizenHashedPasswordFake12345",
      role: "citizen",
      xp: 45,
      created_at: new Date().toISOString(),
    }
  ],
  issues: [
    {
      id: 1,
      reporter_id: 2,
      category: "pothole",
      status: "verified",
      description: "Huge cavernous pothole right on the crosswalk.",
      image_url: "https://images.unsplash.com/photo-1515162305285-0293e4767cc2?auto=format&fit=crop&w=800&q=80",
      latitude: 37.4220,
      longitude: -122.0841,
      ward: "Downtown Ward 1",
      severity: 4,
      ai_summary: "Severe pothole posing tire blowout risk on high-traffic intersection.",
      vote_count: 3,
      cluster_id: null,
      assigned_to: null,
      resolved_image_url: null,
      created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 2,
      reporter_id: 2,
      category: "broken_light",
      status: "pending",
      description: "The entire alley is pitch black, street light is dead.",
      image_url: "https://images.unsplash.com/photo-1508873535684-277a3cbcc4e8?auto=format&fit=crop&w=800&q=80",
      latitude: 37.4250,
      longitude: -122.0800,
      ward: "North Heights Ward 2",
      severity: 3,
      ai_summary: "Unlit public alleyway reducing safety and visibility.",
      vote_count: 1,
      cluster_id: null,
      assigned_to: null,
      resolved_image_url: null,
      created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 3,
      reporter_id: 2,
      category: "water_leak",
      status: "assigned",
      description: "Drinking water flooding down the slope. Huge waste!",
      image_url: "https://images.unsplash.com/photo-1542013936693-8848e574047e?auto=format&fit=crop&w=800&q=80",
      latitude: 37.4200,
      longitude: -122.0900,
      ward: "West End Ward 3",
      severity: 5,
      ai_summary: "Main pipe burst releasing high-volume water stream.",
      vote_count: 5,
      cluster_id: null,
      assigned_to: "Rapid Response Crew Alpha",
      resolved_image_url: null,
      created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 4,
      reporter_id: 2,
      category: "waste",
      status: "resolved",
      description: "Piles of trash left in front of the community park.",
      image_url: "https://images.unsplash.com/photo-1611284446314-60a58ac0deb9?auto=format&fit=crop&w=800&q=80",
      latitude: 37.4235,
      longitude: -122.0870,
      ward: "Downtown Ward 1",
      severity: 2,
      ai_summary: "Uncontrolled household garbage pile outside park entrance.",
      vote_count: 3,
      cluster_id: null,
      assigned_to: "Sanitation Squad B",
      resolved_image_url: "https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?auto=format&fit=crop&w=800&q=80",
      created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    }
  ],
  votes: [
    { id: 1, user_id: 1, issue_id: 1, created_at: new Date().toISOString() },
    { id: 2, user_id: 2, issue_id: 2, created_at: new Date().toISOString() }
  ],
  alerts: [
    {
      id: 1,
      ward: "Downtown Ward 1",
      category: "waste",
      risk_level: "medium",
      summary: "Spike in illegal littering cases triggers alert. Sanitation runs should be increased to prevent infestations.",
      active: true,
      created_at: new Date().toISOString()
    },
    {
      id: 2,
      ward: "West End Ward 3",
      category: "water_leak",
      risk_level: "high",
      summary: "High density of pipeline stress issues forecast. Imminent risk of structural pipeline breakage.",
      active: true,
      created_at: new Date().toISOString()
    }
  ],
};

function readDB(): DB {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(defaultDB, null, 2));
      return defaultDB;
    }
    const data = fs.readFileSync(DATA_FILE, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    console.error("DB reading error, using default", err);
    return defaultDB;
  }
}

function writeDB(db: DB) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  } catch (err) {
    console.error("DB saving error", err);
  }
}

// =====================================================================
// GEMINI API UTILITIES
// =====================================================================
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    })
  : null;

// =====================================================================
// GEODESIC DISTANCE (Haversine)
// =====================================================================
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in meters
}

function checkBackendAlive(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(150);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

const proxyMiddleware = async (req: any, res: any, next: any) => {
  if (!req.url.startsWith("/api")) {
    return next();
  }

  const isAlive = await checkBackendAlive(8000, "127.0.0.1");
  if (!isAlive) {
    return next();
  }

  const options = {
    hostname: "127.0.0.1",
    port: 8000,
    path: req.originalUrl || req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: "127.0.0.1:8000"
    }
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on("error", (err: any) => {
    console.error("[Proxy] Request forwarding error:", err.message);
    if (!res.headersSent) {
      res.status(502).json({ detail: "Bad Gateway - Proxy failed" });
    }
  });

  req.pipe(proxyReq, { end: true });
};

app.use((req: Request, res: Response, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.use(proxyMiddleware);
app.use(express.json());




// Simple JWT Auth Mock middleware (Header format: "Bearer <email>")
function requireUser(req: Request, res: Response, next: () => void) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ detail: "Missing or invalid token" });
  }
  const email = authHeader.split(" ")[1];
  const db = readDB();
  const user = db.users.find((u) => u.email === email || email.includes(u.email));
  if (!user) {
    return res.status(401).json({ detail: "Authorized user not found" });
  }
  (req as any).user = user;
  next();
}

function requireAdmin(req: Request, res: Response, next: () => void) {
  requireUser(req, res, () => {
    const user = (req as any).user;
    if (user.role !== "admin") {
      return res.status(403).json({ detail: "Admin permissions required" });
    }
    next();
  });
}

// =====================================================================
// API ROUTE IMPLEMENTATIONS
// =====================================================================

// POST /api/auth/register
app.post("/api/auth/register", (req: Request, res: Response) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ detail: "All fields name, email, password are required" });
  }

  const db = readDB();
  const exists = db.users.some((u) => u.email.toLowerCase() === email.toLowerCase());
  if (exists) {
    return res.status(400).json({ detail: "Email is already registered" });
  }

  const newUser: User = {
    id: db.users.length ? Math.max(...db.users.map((u) => u.id)) + 1 : 1,
    name,
    email,
    password_hash: "HashedPasswordFake_" + password, // simplified for fast hackathon demo
    role: role === "admin" ? "admin" : "citizen",
    xp: 0,
    created_at: new Date().toISOString(),
  };

  db.users.push(newUser);
  writeDB(db);

  res.status(201).json({
    id: newUser.id,
    name: newUser.name,
    email: newUser.email,
    role: newUser.role,
    xp: newUser.xp,
    created_at: newUser.created_at,
  });
});

// POST /api/auth/login
app.post("/api/auth/login", (req: Request, res: Response) => {
  const { email, password } = req.body;
  const db = readDB();
  const user = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    return res.status(401).json({ detail: "Invalid email or password" });
  }

  // Token is just their email in this simplified mock for standard hackathon client convenience
  res.json({
    access_token: user.email,
    token_type: "bearer",
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      xp: user.xp,
    },
  });
});

// GET /api/issues/map
app.get("/api/issues/map", (req: Request, res: Response) => {
  const { min_lat, max_lat, min_lon, max_lon } = req.query;
  const db = readDB();
  let issues = db.issues.filter((i) => i.status !== "resolved");

  if (min_lat && max_lat && min_lon && max_lon) {
    const minLat = parseFloat(min_lat as string);
    const maxLat = parseFloat(max_lat as string);
    const minLon = parseFloat(min_lon as string);
    const maxLon = parseFloat(max_lon as string);

    issues = issues.filter(
      (i) =>
        i.latitude >= minLat &&
        i.latitude <= maxLat &&
        i.longitude >= minLon &&
        i.longitude <= maxLon
    );
  }

  res.json(issues);
});

// POST /api/issues/report
app.post("/api/issues/report", requireUser, upload.single("image"), async (req: Request, res: Response) => {
  const user = (req as any).user as User;
  const file = req.file;
  const latitude = parseFloat(req.body.latitude || "37.4220");
  const longitude = parseFloat(req.body.longitude || "-122.0841");
  const description = req.body.description || "";

  if (!file) {
    return res.status(400).json({ detail: "An image photograph of the issue is required" });
  }

  // 1. Assign Ward Name
  let ward = "Downtown Ward 1";
  if (latitude > 37.423) {
    ward = "North Heights Ward 2";
  } else if (longitude < -122.086) {
    ward = "West End Ward 3";
  }

  // 2. Generate Simulated Image URL
  const base64Image = file.buffer.toString("base64");
  const image_url = `data:${file.mimetype};base64,${base64Image}`;

  // 3. Call Gemini Vision Model to auto-analyze
  let category: "pothole" | "water_leak" | "broken_light" | "waste" | "other" = "other";
  let severity = 1;
  let ai_summary = "Issue logged by citizen.";

  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: [
          {
            inlineData: {
              mimeType: file.mimetype,
              data: base64Image,
            },
          },
          `Analyze this civic issue photo. You MUST return a JSON object with this exact schema:
           {
             "category": "pothole",
             "severity": 3,
             "summary": "Pothole detected in center of the road."
           }
           Valid category string must be one of: "pothole", "water_leak", "broken_light", "waste", "other".
           Severity must be an integer 1-5.
           Summary must be 1 concise sentence, max 15 words.
           Context from reporter: ${description}`,
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              category: { type: Type.STRING },
              severity: { type: Type.INTEGER },
              summary: { type: Type.STRING },
            },
            required: ["category", "severity", "summary"],
          },
        },
      });

      const analysis = JSON.parse(response.text || "{}");
      const cat = analysis.category?.toLowerCase();
      if (["pothole", "water_leak", "broken_light", "waste", "other"].includes(cat)) {
        category = cat;
      } else {
        category = "other";
      }
      severity = Math.max(1, Math.min(5, Number(analysis.severity || 1)));
      ai_summary = analysis.summary || description || "Civic issue reported.";
    } catch (e) {
      console.error("Gemini Vision Error:", e);
      // Fallback
      if (description.toLowerCase().includes("pothole") || description.toLowerCase().includes("road")) {
        category = "pothole";
      } else if (description.toLowerCase().includes("water") || description.toLowerCase().includes("leak")) {
        category = "water_leak";
      } else if (description.toLowerCase().includes("light") || description.toLowerCase().includes("dark")) {
        category = "broken_light";
      } else if (description.toLowerCase().includes("trash") || description.toLowerCase().includes("garbage")) {
        category = "waste";
      }
      severity = 3;
      ai_summary = description || "Civic issue submitted.";
    }
  } else {
    // Basic heuristics fallback
    const descLower = description.toLowerCase();
    if (descLower.includes("pothole") || descLower.includes("road") || descLower.includes("street")) {
      category = "pothole";
    } else if (descLower.includes("water") || descLower.includes("leak") || descLower.includes("pipe")) {
      category = "water_leak";
    } else if (descLower.includes("light") || descLower.includes("lamp") || descLower.includes("dark")) {
      category = "broken_light";
    } else if (descLower.includes("trash") || descLower.includes("garbage") || descLower.includes("waste")) {
      category = "waste";
    }
    severity = Math.floor(Math.random() * 3) + 2; // 2-4
    ai_summary = description || "Civic issue submitted.";
  }

  const db = readDB();

  // 4. Duplicate cluster grouping (<= 100 meters, matching category)
  let cluster_id: number | null = null;
  const matchIssues = db.issues.filter((i) => i.category === category && i.status !== "resolved");
  for (const match of matchIssues) {
    const dist = getDistance(latitude, longitude, match.latitude, match.longitude);
    if (dist <= 100) {
      if (match.cluster_id) {
        cluster_id = match.cluster_id;
      } else {
        match.cluster_id = match.id;
        cluster_id = match.id;
      }
      break;
    }
  }

  // 5. Save Issue
  const newIssue: Issue = {
    id: db.issues.length ? Math.max(...db.issues.map((i) => i.id)) + 1 : 1,
    reporter_id: user.id,
    category,
    status: "pending",
    description,
    image_url,
    latitude,
    longitude,
    ward,
    severity,
    ai_summary,
    vote_count: 0,
    cluster_id,
    assigned_to: null,
    resolved_image_url: null,
    created_at: new Date().toISOString(),
  };

  db.issues.push(newIssue);

  // Award Reporter with +10 XP
  const dbUser = db.users.find((u) => u.id === user.id);
  if (dbUser) {
    dbUser.xp += 10;
  }

  writeDB(db);

  res.status(201).json(newIssue);
});

// POST /api/issues/:id/vote
app.post("/api/issues/:id/vote", requireUser, (req: Request, res: Response) => {
  const user = (req as any).user as User;
  const id = parseInt(req.params.id);
  const db = readDB();

  const issue = db.issues.find((i) => i.id === id);
  if (!issue) {
    return res.status(404).json({ detail: "Civic issue report not found" });
  }

  if (issue.status === "resolved") {
    return res.status(400).json({ detail: "Cannot upvote resolved issues" });
  }

  // Verify unique vote
  const voted = db.votes.some((v) => v.user_id === user.id && v.issue_id === id);
  if (voted) {
    return res.status(400).json({ detail: "You have already upvoted this issue report" });
  }

  // Add vote
  db.votes.push({
    id: db.votes.length ? Math.max(...db.votes.map((v) => v.id)) + 1 : 1,
    user_id: user.id,
    issue_id: id,
    created_at: new Date().toISOString(),
  });

  issue.vote_count += 1;

  // Auto transition to "verified" at 3 upvotes
  if (issue.vote_count >= 3 && issue.status === "pending") {
    issue.status = "verified";
  }

  // Reward voter with +5 XP
  const dbUser = db.users.find((u) => u.id === user.id);
  if (dbUser) {
    dbUser.xp += 5;
  }

  writeDB(db);

  res.json({
    message: "Vote cast successfully",
    vote_count: issue.vote_count,
    status: issue.status,
    user_xp: dbUser?.xp || user.xp,
  });
});

// PATCH /api/issues/:id/assign
app.patch("/api/issues/:id/assign", requireAdmin, (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const { assigned_to } = req.body;
  if (!assigned_to) {
    return res.status(400).json({ detail: "Assignee target crew name is required" });
  }

  const db = readDB();
  const issue = db.issues.find((i) => i.id === id);
  if (!issue) {
    return res.status(404).json({ detail: "Civic issue report not found" });
  }

  issue.assigned_to = assigned_to;
  issue.status = "assigned";

  writeDB(db);
  res.json(issue);
});

// POST /api/issues/:id/resolve
app.post("/api/issues/:id/resolve", requireAdmin, upload.single("resolved_image"), (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const file = req.file;

  if (!file) {
    return res.status(400).json({ detail: "Proof photograph of completed resolution is required" });
  }

  const db = readDB();
  const issue = db.issues.find((i) => i.id === id);
  if (!issue) {
    return res.status(404).json({ detail: "Civic issue report not found" });
  }

  const base64Image = file.buffer.toString("base64");
  const resolved_image_url = `data:${file.mimetype};base64,${base64Image}`;

  issue.status = "resolved";
  issue.resolved_image_url = resolved_image_url;

  // Reward original reporter with +20 XP
  const reporter = db.users.find((u) => u.id === issue.reporter_id);
  if (reporter) {
    reporter.xp += 20;
  }

  writeDB(db);
  res.json({
    message: "Civic issue successfully resolved",
    issue,
  });
});

// POST /api/alerts/run-predictions
app.post("/api/alerts/run-predictions", requireAdmin, async (req: Request, res: Response) => {
  const db = readDB();

  // Filter last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentIssues = db.issues.filter((i) => new Date(i.created_at) >= thirtyDaysAgo);

  if (recentIssues.length === 0) {
    return res.json({
      status: "success",
      alerts_created: 0,
      message: "No active issues reported in the last 30 days to compute predictions.",
    });
  }

  // Group issues by ward
  const wardGroups: { [ward: string]: any[] } = {};
  for (const issue of recentIssues) {
    if (!wardGroups[issue.ward]) {
      wardGroups[issue.ward] = [];
    }
    wardGroups[issue.ward].push({
      category: issue.category,
      severity: issue.severity,
      status: issue.status,
      description: issue.description,
    });
  }

  // Clear current active alerts to rebuild
  db.alerts.forEach((a) => (a.active = false));

  let alertsCreated = 0;

  for (const [wardName, issues] of Object.entries(wardGroups)) {
    let risk_level: "low" | "medium" | "high" = "low";
    let dominant_category = "other";
    let alert_needed = false;
    let summary = "Civic integrity stable.";

    // Simple frequency/severity statistics
    const catCounts: { [cat: string]: number } = {};
    let totalSeverity = 0;
    issues.forEach((i) => {
      catCounts[i.category] = (catCounts[i.category] || 0) + 1;
      totalSeverity += i.severity;
    });

    if (Object.keys(catCounts).length > 0) {
      dominant_category = Object.keys(catCounts).reduce((a, b) =>
        catCounts[a] > catCounts[b] ? a : b
      );
    }

    const avgSeverity = totalSeverity / issues.length;

    if (ai) {
      try {
        const response = await ai.models.generateContent({
          model: "gemini-1.5-flash",
          contents: `Analyze these recent civic issue logs for Ward "${wardName}":
          ${JSON.stringify(issues)}
          
          Assess predictive ward risk of upcoming infrastructure failure.
          Return a JSON object with this exact schema:
          {
            "risk_level": "medium",
            "dominant_category": "water_leak",
            "alert_needed": true,
            "summary": "High frequency of pipe ruptures predicts cascading main water leakage risk soon."
          }
          risk_level must be one of "low", "medium", "high".
          alert_needed should be boolean.
          summary must be 1-2 sentences, max 30 words forecasting future risk.`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                risk_level: { type: Type.STRING },
                dominant_category: { type: Type.STRING },
                alert_needed: { type: Type.BOOLEAN },
                summary: { type: Type.STRING },
              },
              required: ["risk_level", "dominant_category", "alert_needed", "summary"],
            },
          },
        });

        const analysis = JSON.parse(response.text || "{}");
        const r_lvl = analysis.risk_level?.toLowerCase();
        if (["low", "medium", "high"].includes(r_lvl)) {
          risk_level = r_lvl;
        }
        alert_needed = Boolean(analysis.alert_needed);
        summary = analysis.summary || "Maintenance tracking recommended.";
        dominant_category = analysis.dominant_category || dominant_category;
      } catch (err) {
        console.error("Gemini Predictions Error:", err);
        // Backup heuristic
        if (issues.length >= 4 || avgSeverity >= 4) {
          risk_level = "high";
          alert_needed = true;
          summary = `High concentration of ${dominant_category} issues predicts structural failure risk in ${wardName}.`;
        } else if (issues.length >= 2) {
          risk_level = "medium";
          alert_needed = true;
          summary = `Spike in reported ${dominant_category} issues. Periodic maintenance inspection suggested.`;
        }
      }
    } else {
      // Rule-based heuristic
      if (issues.length >= 4 || avgSeverity >= 4) {
        risk_level = "high";
        alert_needed = true;
        summary = `High concentration of ${dominant_category} issues predicts structural failure risk in ${wardName}.`;
      } else if (issues.length >= 2) {
        risk_level = "medium";
        alert_needed = true;
        summary = `Spike in reported ${dominant_category} issues. Periodic maintenance inspection suggested.`;
      }
    }

    if (alert_needed) {
      db.alerts.push({
        id: db.alerts.length ? Math.max(...db.alerts.map((a) => a.id)) + 1 : 1,
        ward: wardName,
        category: dominant_category,
        risk_level,
        summary,
        active: true,
        created_at: new Date().toISOString(),
      });
      alertsCreated += 1;
    }
  }

  writeDB(db);

  res.json({
    status: "success",
    alerts_created: alertsCreated,
    message: `Risk modeling complete. Generated ${alertsCreated} new active alerts.`,
  });
});

// GET /api/alerts/active
app.get("/api/alerts/active", (req: Request, res: Response) => {
  const db = readDB();
  const activeAlerts = db.alerts.filter((a) => a.active);

  // Sort descending: high -> medium -> low
  const priority: { [key: string]: number } = { high: 3, medium: 2, low: 1 };
  activeAlerts.sort((a, b) => priority[b.risk_level] - priority[a.risk_level]);

  res.json(activeAlerts);
});

// GET /api/alerts/leaderboard
app.get("/api/alerts/leaderboard", (req: Request, res: Response) => {
  const db = readDB();

  // Group resolved issues by ward
  const counts: { [ward: string]: number } = {};
  db.issues
    .filter((i) => i.status === "resolved")
    .forEach((i) => {
      counts[i.ward] = (counts[i.ward] || 0) + 1;
    });

  const leaderboard = Object.entries(counts)
    .map(([ward, resolved_count]) => ({ ward, resolved_count }))
    .sort((a, b) => b.resolved_count - a.resolved_count);

  res.json(leaderboard);
});

// =====================================================================
// FRONTEND BUNDLE AND VITE CONFIGURATION
// =====================================================================
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
