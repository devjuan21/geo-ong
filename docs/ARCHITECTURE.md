# GeoSafe System Architecture & Security Guide

> **Capstone Title**: *GeoSafe: A Web-Based Disaster Reporting and Emergency Assistance System for Real-Time Response in Barangay Bayanan, Muntinlupa City*

## 1. Repository Layout

```text
geo-ong/
├── frontend/                   # Resident, Responder & Administrator UI Portals
│   ├── assets/
│   │   ├── css/style.css       # Compiled Tailwind CSS stylesheet
│   │   ├── icons/              # Application & PWA icons
│   │   ├── js/                 # Modular ES6+ frontend controllers, mapping-service.js & store.js
│   │   └── vendor/leaflet/     # Local Leaflet v1.9.4 CSS, JS & marker images for offline LAN use
│   ├── icons/                  # PWA manifest icon path compatibility
│   ├── src/input.css           # Tailwind CSS source directives
│   ├── *.html                  # Portal HTML pages (Resident, Responder, Admin, Login)
│   ├── manifest.json           # Web App Manifest
│   ├── sw.js                   # Service Worker
│   ├── server.js               # Standalone frontend static dev proxy server (port 3000)
│   ├── tailwind.config.js      # Tailwind theme configuration
│   └── package.json            # Frontend build scripts & Tailwind devDependency
├── backend/                    # Node.js + Express REST API & Socket.IO Server
│   ├── config/
│   │   ├── db.js               # PostgreSQL (pg.Pool) / SQL connection pool (geosafe_db)
│   │   └── roles.js            # Canonical RBAC role IDs (1=Admin, 2=Responder, 3=Resident)
│   ├── controllers/            # Route handlers (auth, reports, rescues, alerts, admin)
│   ├── middleware/
│   │   ├── auth.js             # HttpOnly session cookie, CSRF check & live DB user lookup
│   │   └── rbac.js             # Role-Based Access Control enforcement
│   ├── models/                 # Database pool adapter & user query helpers
│   ├── routes/                 # Express REST routers (/api & /api/v1)
│   ├── services/
│   │   └── socketService.js    # Socket.IO real-time room & broadcast service
│   ├── scripts/
│   │   ├── create-admin.js     # One-time interactive CLI initial Administrator provisioning
│   │   ├── verify-auth.js      # End-to-end authentication & RBAC verification suite
│   │   └── ui-verification/    # Automated frontend & portal compliance checks
│   ├── .env.example            # Environment variable template (no real secrets)
│   ├── server.js               # Express + Socket.IO server entry point & HTML portal guard
│   └── package.json            # Backend dependencies & npm scripts
├── database/                   # Canonical PostgreSQL Database Schema & Migrations
│   ├── geosafe_db_postgres.sql # Complete 32-table PostgreSQL schema with RESTRICT FKs & triggers
│   ├── geosafe_db_schema.sql   # SQL schema reference
│   ├── verify_database.sql     # Read-only database verification script
│   ├── migrate_backup_to_postgres.js # PostgreSQL migration helper
│   ├── migrations/             # Incremental SQL migrations
│   ├── REVISION_NOTES.md       # Database release & foreign key audit notes
│   └── archive/                # Preserved SQL & backup snapshots
├── docs/                       # Project Documentation
│   ├── ARCHITECTURE.md         # System architecture, security & LAN offline guide
│   └── DATABASE_GUIDE.md       # PostgreSQL schema & foreign key protection guide
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
   - Every authenticated HTTP and HTML portal request queries `users` joined with `roles` in PostgreSQL (`geosafe_db`).
   - Verifies that the account exists, has `account_status = 'active'` and `status = 'active'`, and has not been revoked in `auth_security_logs`.
3. **Authoritative Role Enforcement (`backend/middleware/rbac.js` & `backend/server.js`)**:
   - Roles are strictly determined from the database (`users.role_id`: `1 = Administrator`, `2 = Responder`, `3 = Resident`).
   - Server-side HTML route protection in `backend/server.js` redirects unauthenticated visitors to `/login.html` (`HTTP 302`) and returns `HTTP 403` if a user attempts to open another role's portal.
4. **One-Time Initial Administrator Provisioning (`backend/scripts/create-admin.js`)**:
   - Public registration (`POST /api/register`) exclusively creates `Resident` (`role_id = 3`) accounts.
   - The first `Administrator` (`role_id = 1`) is provisioned via `npm run create-admin` in `backend/` using interactive TTY prompts and `bcrypt` (`12` rounds).

---

## 3. Real-Time Socket.IO Architecture

- `backend/services/socketService.js` initializes Socket.IO on the shared HTTP server and authenticates connections using the `geosafe_session` cookie.
- Users join role-based rooms (`role:Resident`, `role:Responder`, `role:Administrator`) and user-specific rooms (`user:<id>`).
- `frontend/assets/js/store.js` dynamically loads `/socket.io/socket.io.js` upon session verification, connects with automatic reconnection, deduplicates incoming toast notifications (`GeoSafeToast`), dispatches `geosafe:realtime-update` DOM events so active views refresh automatically, and syncs missed unread notifications/alerts on reconnect.

---

## 4. Offline & Multi-Laptop LAN Support

- **0.0.0.0 Binding & Dynamic CORS**: `backend/server.js` listens on `0.0.0.0:3000` so multiple laptops on the same Wi-Fi/LAN can access the portal via `http://<HOST-LAN-IP>:3000`.
- **Local Leaflet Bundle & Offline Grid Map**: All map pages load `./assets/vendor/leaflet/leaflet.css` and `./assets/vendor/leaflet/leaflet.js` locally. `GeoSafeMapping.addBaseTileLayer(map)` automatically falls back to a custom Barangay Bayanan `L.GridLayer` SVG coordinate grid when offline or when OpenStreetMap tiles fail to load.
- **Offline Geocoding & Routing Fallbacks**: `GeoSafeMapping.reverseGeocode()` returns a local Barangay Bayanan sector approximation when offline, and `GeoSafeMapping.calculatePedestrianRoute()` / `getWalkingRoute()` computes a Haversine-based distance and walking-time waypoint path when OSRM is unreachable.
- **LAN HTTP Geolocation Fallback**: When accessed over non-HTTPS LAN (`window.isSecureContext === false`), `GeoSafeMapping.getCurrentLocation()` notifies the user via `GeoSafeToast.info` to click or drag the map pin to set their exact Barangay Bayanan coordinates.
