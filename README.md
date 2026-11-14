# GeoSafe: A Web-Based Disaster Reporting and Emergency Assistance System for Real-Time Response in Barangay Bayanan, Muntinlupa City

> **Barangay Bayanan, Muntinlupa City, Metro Manila**

GeoSafe is a web-based disaster reporting, emergency rescue dispatch, evacuation routing, and real-time hazard alert platform connecting **Residents**, **Responders**, and **Administrators** through a Node.js + Express REST API, Socket.IO real-time messaging, and a PostgreSQL (`geosafe_db`) relational database.

---

## Key System Capabilities

- **Role-Based Portals**: Dedicated Resident, Responder, and Administrator portals backed by server-verified `HttpOnly` session cookies and CSRF protection.
- **Real-Time Socket.IO Alerts & Updates**: Live hazard alert broadcasts (`Critical`, `High`, `Moderate`), incident report notifications, rescue dispatch updates, and automatic UI data synchronization across connected clients.
- **Offline & Multi-Laptop LAN Support**:
  - Express server binds to `0.0.0.0` (`PORT=3000`) for multi-laptop LAN access without internet dependency.
  - Local **Leaflet v1.9.4** bundle (`frontend/assets/vendor/leaflet/`) with an automatic Barangay Bayanan offline SVG/Grid tile layer fallback (`L.GridLayer`), offline reverse-geocoding zone approximation, and offline pedestrian route estimation.
  - Graceful browser GPS fallback over non-HTTPS LAN connections guiding users to click or drag the interactive map pin.
- **Manual Administrator Triage**: Administrators manually review incident reports and rescue requests, assign official severity/priority, and dispatch Barangay Bayanan responders.

---

## Repository Structure

```text
geo-ong/
├── frontend/
│   ├── assets/
│   │   ├── css/style.css           # Compiled Tailwind CSS stylesheet
│   │   ├── icons/                  # Application & PWA icons
│   │   ├── js/                     # Modular frontend controllers, mapping-service.js & store.js (Socket.IO)
│   │   └── vendor/leaflet/         # Local Leaflet v1.9.4 CSS, JS & marker icons (offline-ready)
│   ├── icons/                      # PWA manifest icon directory
│   ├── src/input.css               # Tailwind CSS source file
│   ├── index.html                  # Resident Portal — Dashboard & Community Map
│   ├── login.html                  # Public Authentication & Resident Registration Portal
│   ├── report-rescue.html          # Resident Portal — Unified Incident & Rescue Submission
│   ├── report-incident.html        # Resident Portal — Incident Report Form
│   ├── rescue-requests.html        # Resident Portal — Rescue Requests Tracker
│   ├── my-reports.html             # Resident Portal — Submitted Reports History
│   ├── evacuation-routes.html      # Resident Portal — Interactive Safe Haven Routing
│   ├── evacuation-centers.html     # Resident Portal — Evacuation Shelters Directory
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
│   ├── server.js                   # Standalone frontend static dev server (proxies /api to port 3000)
│   ├── tailwind.config.js          # Tailwind CSS configuration
│   └── package.json                # Frontend build scripts & dependencies
├── backend/
│   ├── config/
│   │   ├── db.js                   # PostgreSQL (pg.Pool) / SQL connection pool (geosafe_db)
│   │   └── roles.js                # Authoritative RBAC role definitions (1=Admin, 2=Responder, 3=Resident)
│   ├── controllers/                # Express route controllers
│   ├── middleware/
│   │   ├── auth.js                 # HttpOnly session cookie, CSRF check & live DB session verification
│   │   └── rbac.js                 # Role-Based Access Control middleware
│   ├── models/                     # Database pool adapter & user model helpers
│   ├── routes/                     # REST API route definitions (/api & /api/v1)
│   ├── services/
│   │   └── socketService.js        # Socket.IO real-time broadcast service
│   ├── scripts/
│   │   ├── create-admin.js         # One-time interactive CLI initial Administrator provisioning
│   │   ├── verify-auth.js          # End-to-end authentication & RBAC verification suite
│   │   └── ui-verification/        # Automated UI & portal verification scripts
│   ├── .env.example                # Environment configuration template
│   ├── server.js                   # Express + Socket.IO server entry point (0.0.0.0:3000)
│   └── package.json                # Backend scripts & dependencies
├── database/
│   ├── geosafe_db_postgres.sql     # Canonical 32-table PostgreSQL schema (RESTRICT FKs, triggers, Bayanan seed)
│   ├── geosafe_db_schema.sql       # SQL schema reference
│   ├── verify_database.sql         # Read-only database verification script
│   ├── migrate_backup_to_postgres.js # PostgreSQL migration helper
│   ├── migrations/                 # Incremental SQL migrations
│   ├── REVISION_NOTES.md           # Database revision & historical record protection notes
│   └── archive/                    # Preserved SQL and backup snapshots
├── docs/
│   ├── ARCHITECTURE.md             # Architecture, authentication, Socket.IO & LAN guide
│   └── DATABASE_GUIDE.md           # PostgreSQL schema & foreign key protection guide
├── README.md
└── .gitignore
```

---

## Getting Started

### 1. Database Setup (`PostgreSQL`)

1. Ensure PostgreSQL is running and execute [`database/geosafe_db_postgres.sql`](database/geosafe_db_postgres.sql) to create the `geosafe_db` database (32 tables, `ON DELETE RESTRICT` foreign keys, PL/pgSQL triggers, canonical RBAC roles, and verified Barangay Bayanan evacuation centers/routes).
2. Optional: Execute [`database/verify_database.sql`](database/verify_database.sql) to verify schema readiness.

### 2. Backend Configuration

```powershell
cd backend
Copy-Item .env.example .env
```

Edit `backend/.env` with your local PostgreSQL credentials:

```env
PORT=3000
HOST=0.0.0.0
JWT_SECRET=replace-with-a-strong-random-secret
DB_CLIENT=postgres
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_postgres_password
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

Open **`http://localhost:3000/login.html`** (or `http://<LAN-IP>:3000/login.html` from another laptop on the same local network):
- **Resident Accounts** -> Redirected to `/index.html`
- **Responder Accounts** -> Redirected to `/responder-dashboard.html`
- **Administrator Accounts** -> Redirected to `/admin.html`

---

## NPM Scripts Reference

### Backend (`cd backend`)
| Command | Description |
| :--- | :--- |
| `npm start` | Start the Express + Socket.IO server (`server.js`) serving `/api/*` and `../frontend` |
| `npm run dev` | Start the backend server in watch mode (`node --watch server.js`) |
| `npm run create-admin` | Interactive one-time CLI provisioning for the first Administrator account (`scripts/create-admin.js`) |
| `npm run verify-auth` | Run the end-to-end authentication & RBAC verification suite (`scripts/verify-auth.js`) |
| `npm run verify-ui` | Run the frontend UI & fresh-state compliance suite (`scripts/ui-verification/verify-all.js`) |

### Frontend (`cd frontend`)
| Command | Description |
| :--- | :--- |
| `npm run build` | Compile and minify Tailwind CSS (`src/input.css` -> `assets/css/style.css`) |
| `npm run watch:css` | Watch HTML/JS files and recompile Tailwind CSS on change |
| `npm start` | Run the standalone frontend static dev server (`frontend/server.js`) |
