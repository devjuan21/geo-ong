# GeoSafe — Disaster Reporting & Emergency Assistance System

> **Barangay Bayanan, Muntinlupa City, Metro Manila**

GeoSafe is a web-based disaster reporting, emergency rescue dispatch, evacuation routing, and family safety platform connecting **Residents**, **Responders**, and **Administrators** through a Node.js + Express REST API and a MySQL (`geosafe_db`) relational database.

---

## Repository Structure

```text
GEOSAFE-SYSTEM/
├── frontend/
│   ├── assets/
│   │   ├── css/style.css           # Compiled Tailwind CSS stylesheet
│   │   ├── icons/                  # Application & PWA icons
│   │   └── js/                     # Modular frontend controllers & REST API client (store.js)
│   ├── icons/                      # PWA manifest icon directory
│   ├── legacy/                     # Archived v1 prototype files
│   ├── src/input.css               # Tailwind CSS source file
│   ├── index.html                  # Resident Portal — Dashboard
│   ├── login.html                  # Public Authentication & Resident Registration Portal
│   ├── report-rescue.html          # Resident Portal — Unified Incident & Rescue Submission
│   ├── report-incident.html        # Resident Portal — Incident Report Form
│   ├── rescue-requests.html        # Resident Portal — Rescue Requests Tracker
│   ├── my-reports.html             # Resident Portal — Submitted Reports History
│   ├── evacuation-routes.html      # Resident Portal — Interactive Safe Haven Routing
│   ├── evacuation-centers.html     # Resident Portal — Evacuation Shelters Directory
│   ├── family.html                 # Resident Portal — QR-Based Family Safety Tracker
│   ├── family-safety.html          # Resident Portal — Household Safety Check-Ins
│   ├── hazard-alerts.html          # Resident Portal — Verified Hazard Advisories
│   ├── notifications.html          # Resident Portal — Notification Center
│   ├── profile.html                # Resident Portal — Resident Profile & Medical Notes
│   ├── settings.html               # Resident Portal — Account & Alert Settings
│   ├── responder-dashboard.html    # Responder Portal — Mission Control Dashboard
│   ├── responder-assignments.html  # Responder Portal — Active Dispatch Assignments
│   ├── responder-map.html          # Responder Portal — Field Operations GIS Map
│   ├── responder-profile.html      # Responder Portal — Responder Credentials & Unit Status
│   ├── admin.html                  # Administrator Portal — BDRRMC Command & Dispatch Console
│   ├── manifest.json               # Web App Manifest
│   ├── sw.js                       # Service Worker
│   ├── server.js                   # Standalone frontend static dev server
│   ├── tailwind.config.js          # Tailwind CSS configuration
│   ├── package.json                # Frontend build scripts & dependencies
│   └── package-lock.json           # Frontend dependency lockfile
├── backend/
│   ├── config/
│   │   ├── db.js                   # MySQL connection pool (geosafe_db)
│   │   └── roles.js                # Authoritative RBAC role definitions (1=Admin, 2=Responder, 3=Resident)
│   ├── controllers/                # Express route controllers
│   ├── middleware/
│   │   ├── auth.js                 # HttpOnly session cookie, CSRF check & live MySQL session verification
│   │   └── rbac.js                 # Role-Based Access Control middleware
│   ├── models/                     # Database pool adapter & user model helpers
│   ├── routes/                     # REST API route definitions (/api & /api/v1)
│   ├── services/
│   │   └── socketService.js        # Socket.IO real-time broadcast service
│   ├── scripts/
│   │   ├── create-admin.js         # One-time interactive CLI initial Administrator provisioning
│   │   ├── verify-auth.js          # End-to-end authentication & RBAC verification suite
│   │   ├── test-iso25010.js        # ISO/IEC 25010 automated evaluation suite
│   │   └── ui-verification/        # Automated UI & portal verification scripts
│   ├── utils/
│   │   ├── prioritizer.js          # Multi-factor rescue triage prioritization engine
│   │   └── severityDetector.js     # Rule-based keyword & negation-aware severity detector
│   ├── .env.example                # Environment configuration template
│   ├── server.js                   # Express + Socket.IO server entry point
│   ├── socket.js                   # Socket.IO compatibility export
│   ├── package.json                # Backend scripts & dependencies
│   └── package-lock.json           # Backend dependency lockfile
├── database/
│   ├── geosafe_db_schema.sql       # Canonical 38-table MySQL schema (51 RESTRICT FKs, 27 triggers)
│   ├── verify_database.sql         # Read-only MySQL Workbench verification script
│   ├── migrations/                 # Incremental SQL migrations (002–008)
│   ├── REVISION_NOTES.md           # Database revision & historical record protection notes
│   └── archive/                    # Preserved SQL and ZIP backups
├── docs/
│   ├── ARCHITECTURE.md             # Architecture, authentication & security documentation
│   ├── DATABASE_GUIDE.md           # Database schema & foreign key protection guide
│   └── archive/                    # Historical design notes & legacy documentation
├── README.md
└── .gitignore
```

---

## Getting Started

### 1. Database Setup (`MySQL Workbench`)

1. Open [`database/geosafe_db_schema.sql`](database/geosafe_db_schema.sql) in **MySQL Workbench** and execute the script to create the fresh `geosafe_db` database (38 tables, 51 `ON DELETE RESTRICT` foreign keys, 27 triggers, and the 3 canonical RBAC roles).
2. Optional: Execute [`database/verify_database.sql`](database/verify_database.sql) to verify schema readiness.

### 2. Backend Configuration

```powershell
cd backend
Copy-Item .env.example .env
```

Edit `backend/.env` with your local MySQL credentials:

```env
PORT=3000
JWT_SECRET=replace-with-a-strong-random-secret
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=geosafe_db
```

### 3. Provision the Initial Administrator Account

From `backend/`, run the one-time interactive CLI provisioning script:

```powershell
cd backend
npm run create-admin
```

### 4. Build Frontend Assets (Optional When Editing Styles)

```powershell
cd frontend
npm run build
```

### 5. Start the GeoSafe Server

```powershell
cd backend
npm start
```

Open **`http://localhost:3000/login.html`** in your browser:
- **Resident Accounts** → Redirected to `/index.html`
- **Responder Accounts** → Redirected to `/responder-dashboard.html`
- **Administrator Accounts** → Redirected to `/admin.html`

---

## NPM Scripts Reference

### Backend (`cd backend`)
| Command | Description |
| :--- | :--- |
| `npm start` | Start the Express + Socket.IO server (`server.js`) serving `/api/*` and `../frontend` |
| `npm run dev` | Start the backend server in watch mode (`node --watch server.js`) |
| `npm run create-admin` | Interactive one-time CLI provisioning for the first Administrator account (`scripts/create-admin.js`) |
| `npm test` | Run the ISO/IEC 25010 triage and security evaluation suite (`scripts/test-iso25010.js`) |
| `npm run verify-auth` | Run the 12-check end-to-end authentication & RBAC verification suite (`scripts/verify-auth.js`) |
| `npm run verify-ui` | Run the frontend UI & fresh-state compliance suite (`scripts/ui-verification/verify-all.js`) |

### Frontend (`cd frontend`)
| Command | Description |
| :--- | :--- |
| `npm run build` | Compile and minify Tailwind CSS (`src/input.css` → `assets/css/style.css`) |
| `npm run watch:css` | Watch HTML/JS files and recompile Tailwind CSS on change |
| `npm start` | Run the standalone frontend static dev server (`frontend/server.js`) |
