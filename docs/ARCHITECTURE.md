# GeoSafe System Architecture & Security Guide

## 1. Repository Layout

```text
GEOSAFE-SYSTEM/
├── frontend/                   # Resident, Responder & Administrator UI Portals
│   ├── assets/
│   │   ├── css/style.css       # Compiled Tailwind CSS stylesheet
│   │   ├── icons/              # Application & PWA icons
│   │   └── js/                 # Modular ES6+ frontend controllers & API store
│   ├── icons/                  # PWA manifest icon path compatibility
│   ├── legacy/                 # Archived v1 prototype pages & adapters
│   ├── src/input.css           # Tailwind CSS source directives
│   ├── *.html                  # Portal HTML pages (Resident, Responder, Admin, Login)
│   ├── manifest.json           # Web App Manifest
│   ├── sw.js                   # Service Worker
│   ├── server.js               # Standalone frontend static dev proxy server
│   ├── tailwind.config.js      # Tailwind theme configuration
│   ├── package.json            # Frontend build scripts & Tailwind devDependency
│   └── package-lock.json       # Frontend dependency lockfile
├── backend/                    # Node.js + Express REST API & Real-Time Server
│   ├── config/
│   │   ├── db.js               # MySQL connection pool (geosafe_db)
│   │   └── roles.js            # Canonical RBAC role IDs (1=Admin, 2=Responder, 3=Resident)
│   ├── controllers/            # Route handlers (auth, reports, rescues, family, alerts, admin)
│   ├── middleware/
│   │   ├── auth.js             # HttpOnly session cookie, CSRF check & live MySQL user lookup
│   │   └── rbac.js             # Role-Based Access Control enforcement
│   ├── models/                 # Database pool adapter & user query helpers
│   ├── routes/                 # Express REST routers (/api & /api/v1)
│   ├── services/
│   │   └── socketService.js    # Socket.IO real-time room & broadcast service
│   ├── scripts/
│   │   ├── create-admin.js     # One-time interactive CLI initial Administrator provisioning
│   │   ├── verify-auth.js      # End-to-end authentication & RBAC verification suite
│   │   └── ui-verification/    # Automated frontend & portal compliance checks
│   ├── utils/                  # Triage severity detector & multi-factor prioritizer
│   ├── .env.example            # Environment variable template (no real secrets)
│   ├── server.js               # Express + Socket.IO server entry point & HTML portal guard
│   ├── socket.js               # Backward-compatible Socket.IO service export
│   ├── package.json            # Backend dependencies & npm scripts
│   └── package-lock.json       # Backend dependency lockfile
├── database/                   # Canonical MySQL Database Schema & Migrations
│   ├── geosafe_db_schema.sql   # Complete 38-table fresh schema with 51 RESTRICT FKs & 27 triggers
│   ├── verify_database.sql     # Read-only MySQL Workbench verification script
│   ├── migrations/             # Incremental SQL migrations (002 through 008)
│   ├── REVISION_NOTES.md       # Database release & foreign key audit notes
│   └── archive/                # Preserved SQL & ZIP backups
├── docs/                       # Project Documentation
│   ├── ARCHITECTURE.md         # System architecture & security guide
│   ├── DATABASE_GUIDE.md       # Database schema, foreign key & Workbench guide
│   └── archive/                # Historical design specifications & original READMEs
├── README.md                   # Main repository documentation
└── .gitignore                  # Git ignore rules (.env, node_modules, logs)
```

---

## 2. Authentication, Session Security & Portal Protection

1. **Server-Managed Session Cookie (`geosafe_session`)**:
   - Issued upon verified login at `POST /api/login` (`backend/controllers/authController.js`).
   - Configured with `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` (in production).
   - Paired with CSRF protection (`X-CSRF-Token` verified on state-changing requests when authenticated via cookie).
2. **Live Database Verification (`backend/middleware/auth.js`)**:
   - Every authenticated HTTP and HTML portal request queries `users` joined with `roles` in MySQL (`geosafe_db`).
   - Verifies that the account exists, has `account_status = 'active'` and `status = 'active'`, and has not been revoked in `auth_security_logs`.
3. **Authoritative Role Enforcement (`backend/middleware/rbac.js` & `backend/server.js`)**:
   - Roles are strictly determined from MySQL (`users.role_id`: `1 = Administrator`, `2 = Responder`, `3 = Resident`).
   - Server-side HTML route protection in `backend/server.js` redirects unauthenticated visitors to `/login.html` (`HTTP 302`) and returns `HTTP 403` if a user attempts to open another role's portal.
4. **One-Time Initial Administrator Provisioning (`backend/scripts/create-admin.js`)**:
   - Public registration (`POST /api/register`) exclusively creates `Resident` (`role_id = 3`) accounts.
   - The first `Administrator` (`role_id = 1`) is provisioned via `npm run create-admin` in `backend/` using interactive TTY prompts, `bcrypt` (`12` rounds), and a MySQL transaction with `FOR UPDATE` row locks.

