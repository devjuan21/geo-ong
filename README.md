# GeoSafe

**A Geolocation-Based Disaster Reporting and Emergency Assistance Application with Real-Time Alerts and Safety Communication Features for Barangay Bayanan**

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System User Roles and Features](#2-system-user-roles-and-features)
   - [Administrator](#a-administrator)
   - [Resident](#b-resident)
   - [Responder](#c-responder)
3. [Major System Modules](#3-major-system-modules)
4. [Important System Workflows](#4-important-system-workflows)
5. [Technology Stack and Architecture](#5-technology-stack-and-architecture)
6. [Database Overview](#6-database-overview)
7. [Installation and Local Setup](#7-installation-and-local-setup)
8. [Project Structure](#8-project-structure)
9. [Security and Data Handling](#9-security-and-data-handling)
10. [System Limitations and Requirements](#10-system-limitations-and-requirements)

---

## 1. Project Overview

**Official Title:** *A Geolocation-Based Disaster Reporting and Emergency Assistance Application with Real-Time Alerts and Safety Communication Features for Barangay Bayanan*

GeoSafe is a web-based emergency reporting, dispatch, and hazard-communication platform built for **Barangay Bayanan, Muntinlupa City, Metro Manila**. It connects residents, field responders, and Barangay Emergency Operations Center (EOC) administrators through geolocation-tagged reporting, verified public hazard mapping, real-time alert broadcasting, evacuation guidance, and assignment-scoped messaging.

### Main Objectives

- Provide residents with a direct digital channel to submit geolocation-tagged incident reports and rescue requests with camera photo evidence.
- Give Barangay Bayanan EOC administrators tools to verify reports before public map publication, dispatch responders, and broadcast time-bound emergency advisories.
- Equip field responders with live assignment management, GPS-guided turn-by-turn/pedestrian navigation, and direct resident communication.
- Maintain accountability through role-based access control (RBAC), server-side session enforcement, and database audit logging.

### Target Community and Intended Users

- **Community:** Barangay Bayanan, Muntinlupa City (boundary enforced via `frontend/assets/data/barangay-bayanan-boundary.geojson` and `backend/utils/bayananBoundary.js`; EOC coordinates anchored at Bayanan Barangay Hall).
- **Intended Users:**
  1. **Administrator** (`role_id = 1`): Barangay EOC / DRRMO staff managing verification, dispatch, user accounts, broadcasts, analytics, and system oversight.
  2. **Responder** (`role_id = 2`): Field emergency personnel accepting and executing incident and rescue dispatches.
  3. **Resident** (`role_id = 3`): Barangay Bayanan residents reporting hazards, requesting rescue, viewing verified community incidents, and navigating to evacuation centers.

### Problems Addressed

- Delayed or unverified disaster reporting during localized flooding, fires, or structural hazards.
- Lack of exact GPS coordinates and visual evidence when residents call for emergency assistance.
- Fragmented communication between residents in distress, dispatched responders, and EOC coordinators.
- Stale emergency advisories remaining visible after hazards subside (addressed by automatic server-side broadcast expiration).

---

## 2. System User Roles and Features

All three canonical roles are enforced in PostgreSQL (`roles` table) and server-side RBAC middleware (`backend/middleware/rbac.js` and HTML portal guards in `backend/server.js`).

### A. Administrator

Accessed via `/admin.html` (`#section-dashboard`, `#section-reports`, `#section-responders`, `#section-users`, `#section-alerts`, `#section-analytics`, `#section-settings`, `#section-audit`, `#section-messages`).

| Feature | Purpose & Workflow | Implementation Status |
| :--- | :--- | :--- |
| **Administrator Dashboard & Live Map** | Displays real-time summary statistics (`GET /api/admin/overview`, `GET /api/admin/stats`), vulnerable resident flags (`GET /api/admin/vulnerable`), and a Leaflet operational map showing incidents, rescues, and live responder positions. | Implemented |
| **Incident & Rescue Review, Verification, Rejection & Closure** | Reviews submitted reports and rescue requests (`GET /api/admin/reports`, `GET /api/admin/reports/:type/:id`). Verifies or rejects reports (`PATCH /api/admin/reports/:type/:id/review`) and closes active verified incidents (`POST /api/admin/reports/incident/:id/close`) when resolved so they leave active public maps while remaining in history. | Implemented |
| **Responder Account Creation & Management** | Creates responder accounts with auto-generated responder codes and temporary password enforcement (`POST /api/admin/users/responders`), monitors responder availability and live GPS locations (`GET /api/admin/responders`, `GET /api/admin/responders/live-locations`). | Implemented |
| **Resident Account & Location Verification Management** | Lists and filters users (`GET /api/admin/users`), activates/suspends accounts (`PATCH /api/admin/users/:id/status`), creates resident accounts (`POST /api/admin/users/residents`), and reviews resident registration location verification (`POST /api/admin/users/:id/location-verification`, filtered by Verified / Pending Review). | Implemented |
| **Responder Dispatch & Recommendations** | Recommends available responders based on proximity/load (`GET /api/admin/responders/recommendations`) and dispatches responders to verified incidents or rescue requests (`POST /api/admin/responders/assign`). | Implemented |
| **Emergency Broadcast Alerts & Auto-Expiration** | Creates and manages targeted Barangay Bayanan hazard alerts (`GET/POST /api/admin/broadcasts`, `PATCH /api/admin/broadcasts/:id/cancel`), manages advisory categories (`GET/POST /api/admin/broadcast-categories`), and configures automatic expiration durations enforced by `broadcastExpirationService.js`. | Implemented |
| **Reports & Analytics (Incident Count)** | Compact EOC **Incident Count** view displaying **Incidents by Day** vertical bar chart aggregated by `created_at` in `Asia/Manila` timezone (`GET /api/admin/analytics`), date range presets (`Today`, `Last 7 Days`, `Last 30 Days`, `This Month`, `Last Month`, `This Year`, `All Available Records`, `Custom Date Range`), CSV export (`GET /api/admin/analytics/export`), Print, Email summary, Category Doughnut, and breakdown tables. | Implemented |
| **Messaging Oversight** | Read-only administrative visibility into active and archived rescue conversations (`GET /api/messages/conversations`, `GET /api/messages/conversations/:id/messages`). Administrators cannot send messages as chat participants. | Implemented |
| **System Settings & Audit Logs** | Reads and updates `system_settings` (`GET /api/admin/settings`, `PATCH/POST /api/admin/settings/:key`) and inspects chronological `audit_logs` (`GET /api/admin/audit-logs`). | Implemented |
| **Evacuation Center & Route Management** | Backend API supports creating (`POST /api/evacuation-centers`) and updating (`PUT/PATCH /api/evacuation-centers/:id`) evacuation centers. A dedicated Admin UI tab for managing centers/routes is not present in `admin.html`. | Partially Implemented (API only; no Admin UI panel) |

### B. Resident

Accessed via `/index.html` and dedicated Resident portal pages (`report-rescue.html`, `rescue-requests.html`, `evacuation-centers.html`, `evacuation-routes.html`, `hazard-alerts.html`, `messages.html`, `notifications.html`, `profile.html`, `settings.html`).

| Feature | Purpose & Workflow | Implementation Status |
| :--- | :--- | :--- |
| **Registration, Login & Location Verification** | Registers and logs in via `/login.html` (`POST /api/register`, `POST /api/login`). Checks GPS coordinates against the Barangay Bayanan boundary (`POST /api/verify-location`) during registration and records location verification status. | Implemented |
| **Resident Dashboard & Community Map** | Displays personal report metrics (`GET /api/dashboard/summary`), recent reports, active hazard alerts widget, nearest evacuation center, and a Leaflet Community Map showing Resident GPS location (blue), verified active public incidents (yellow/orange via `GET /api/reports/public`), and evacuation centers (green). | Implemented |
| **Incident Reporting with Camera & GPS** | Submits disaster/incident reports on `report-rescue.html` (`POST /api/reports`) with category, description, browser GPS coordinates, and camera/photo evidence stored server-side. | Implemented |
| **Rescue Request Submission & Tracking** | Submits emergency rescue requests (`POST /api/rescue-requests`) and tracks request/assignment progress on `rescue-requests.html` (`GET /api/rescue-requests`, `GET /api/rescue-requests/:id`). | Implemented |
| **Dedicated One-Tap SOS Panic Button** | No standalone one-tap SOS endpoint or panic button exists; emergencies are submitted through the **Report / Rescue** workflow (`report-rescue.html`). | Not Implemented |
| **Evacuation Centers & Route Navigation** | Views Barangay Bayanan evacuation centers (`evacuation-centers.html`, `GET /api/evacuation-centers`) and pedestrian evacuation routes (`evacuation-routes.html`, `GET /api/evacuation-routes`) using Leaflet + OSRM Foot routing. | Implemented |
| **Hazard & Broadcast Alerts** | Views active, non-expired official Barangay Bayanan broadcasts (`hazard-alerts.html`, `GET /api/hazard-alerts`, `GET /api/alerts`) with real-time Socket.IO updates. | Implemented |
| **Direct Messaging & Chat Archive** | Communicates in private assignment-linked conversations with assigned Responders (`messages.html`), with per-user archive/unarchive (`PATCH /api/messages/conversations/:id/archive` and `unarchive`), unread count badges, and automatic restore when a new message arrives. | Implemented |
| **Notifications, Profile & Settings** | Views and marks notifications as read (`notifications.html`, `GET /api/notifications`, `PATCH /api/notifications/:id/read`), updates profile/medical/emergency contact info (`profile.html`), and manages password/account settings (`settings.html`, `change-password.html`). | Implemented |

### C. Responder

Accessed via `/responder-dashboard.html`, `responder-assignments.html`, `responder-map.html`, `responder-alerts.html`, `responder-messages.html`, and `responder-profile.html`.

| Feature | Purpose & Workflow | Implementation Status |
| :--- | :--- | :--- |
| **Responder Login & Forced Password Change** | Authenticates with responder credentials; first-time or admin-provisioned accounts with `must_change_password = TRUE` are redirected server-side to `/change-password.html`. | Implemented |
| **Responder Dashboard & Availability Toggle** | Displays `Assigned Task`, `Pending`, `In Progress`, and `Resolved` counts (`GET /api/responder/dashboard/summary`), active assignment overview, and availability toggle (`PATCH /api/responder/availability`). | Implemented |
| **Assignment Acceptance & Status Updates** | Lists assigned incidents and rescue requests (`GET /api/responder/assignments`, `GET /api/responder/assignments/:id`) and updates operational status (`Accepted` → `En Route` → `On Scene` → `Completed`) via `PATCH/PUT /api/responder/assignments/:id/status`. | Implemented |
| **Operational Map & Live GPS Tracking** | Displays assignments, evacuation centers, and hospitals (`GET /api/responder/map-data`), tracks live responder GPS (`POST /api/responder/location`), and renders OSRM pedestrian/navigation routes to the incident/rescue site. | Implemented |
| **Evacuation Center Status Updates** | Responders can update evacuation center occupancy/status via `PUT/PATCH /api/evacuation-centers/:id`. | Implemented (API) |
| **Hospital / Evacuation Handover Tracking** | Hospitals and evacuation centers are queried (`GET /api/hospitals`, `GET /api/emergency-facilities`) and rendered on the responder map, but dedicated patient transport/handover destination recording on assignments is not a separate workflow step. | Partially Implemented |
| **Direct Messaging & Chat Archive** | Private messaging with assigned Residents (`responder-messages.html`) with per-user Archive/Unarchive drawer, active-only header counts, and automatic read-only lock when the rescue assignment is `Completed`. | Implemented |
| **Broadcast Alerts & Responder Profile** | Views active Barangay Bayanan broadcasts (`responder-alerts.html`) and manages unit/profile details (`responder-profile.html`, `GET /api/responder/profile`). | Implemented |

---

## 3. Major System Modules

1. **Geolocation-Based Incident Reporting** (`reportController.js`, `portalRoutes.js`, `report-rescue.js`): Captures browser GPS coordinates, boundary validation against Barangay Bayanan GeoJSON, category metadata, and Base64/camera photo uploads saved to `frontend/assets/uploads/incidents/` or `rescues/`.
2. **Incident Verification and Closure** (`adminController.js`, `reportController.js`): Newly submitted resident reports enter `Pending` status and remain hidden from public maps until an Administrator marks them `Verified`. When resolved, Administrators close verified incidents so they drop off active public maps while remaining in `incident_status_history` and analytics.
3. **Rescue Request and Emergency Dispatch** (`portalRoutes.js`, `adminController.js`): Stores rescue requests in `rescue_requests` (with urgency, headcount, vulnerable flags, and attachments) and links them to `rescue_assignments` when an Administrator assigns a Responder.
4. **Responder Assignment and Operations** (`portalRoutes.js`, `responder-assignments.js`): Tracks assignment lifecycle timestamps (`assigned_at`, `accepted_at`, `en_route_at`, `on_scene_at`, `completed_at`) and writes transitions to `responder_assignment_history` and `rescue_updates` / `incident_updates`.
5. **GPS Tracking and Map Navigation** (`mapping-service.js`, `responder-map.js`, `portalRoutes.js`): Combines Leaflet.js v1.9.4, OpenStreetMap tiles, Project-OSRM Foot routing, and throttled OSM Nominatim reverse geocoding (1 request/sec limit) with responder coordinate telemetry (`POST /api/responder/location`).
6. **Evacuation Centers and Evacuation Routes** (`evacController.js`, `hospitalController.js`, `portalRoutes.js`): Serves verified evacuation centers (`evacuation_centers`, `evacuation_center_facilities`), hospitals (`hospitals`), and preconfigured evacuation routes (`evacuation_routes`, `evacuation_route_waypoints`) with OSRM navigation fallback.
7. **Real-Time Hazard and Emergency Broadcast Alerts** (`adminController.js`, `alertController.js`, `socketService.js`): Persists broadcasts in `emergency_broadcast_logs` and pushes `alert:new` / `alert:cancelled` events via Socket.IO to connected users.
8. **Automatic Broadcast Alert Expiration** (`broadcastExpirationService.js`): Runs a 10-second interval scheduler (`startBroadcastExpirationScheduler(10000)`) that atomically transitions active broadcasts past `expires_at` to `Expired`, logs `EXPIRE_EMERGENCY_BROADCAST` to `audit_logs`, and emits `alert:expired` over Socket.IO.
9. **Safety Communication and Direct Messaging** (`messageController.js`, `messageService.js`, `socketService.js`): Enforces participant-only access for Residents and assigned Responders, read-only oversight for Administrators, per-user `conversation_participants.is_archived` state (with automatic unarchive on incoming messages), unread counts (`message_read_status`), typing indicators, and automatic read-only closure upon assignment completion.
10. **Notification Management** (`portalRoutes.js`, `notifications.js`): Stores user-targeted alerts/updates in `notifications` and `notification_recipients` with per-item and bulk read-status endpoints.
11. **User and Role Management** (`authController.js`, `userController.js`, `adminController.js`): Enforces 3 canonical roles (`1=Administrator`, `2=Responder`, `3=Resident`), sequential role-prefixed user codes (`role_sequences`), account status history (`account_status_history`), and location verification status (`user_profiles`).
12. **Audit Logging** (`adminController.js`, `authController.js`, `server.js`): Records administrative actions in `audit_logs` and authentication/unauthorized access events in `auth_security_logs`.

---

## 4. Important System Workflows

### Incident Reporting
1. Resident submits an incident report with category, GPS coordinates, and optional camera photo (`POST /api/reports`).
2. Backend validates coordinates, writes the record to `reports` (`status = 'Pending'`), and saves photo evidence to `frontend/assets/uploads/incidents/`.
3. Administrator reviews the report in `#section-reports` (`PATCH /api/admin/reports/:type/:id/review`) and marks it `Verified` or `Rejected`.
4. Only `Verified` (non-closed) reports are returned by `GET /api/reports/public` and displayed on the Resident Community Map.
5. Once the hazard is resolved, Administrator closes the incident (`POST /api/admin/reports/incident/:id/close`), removing it from active maps while retaining the record and status history in PostgreSQL.

### Rescue and Emergency Dispatch
1. Resident submits a rescue request (`POST /api/rescue-requests`) with location, emergency details, and optional photo evidence.
2. Administrator reviews the request and views proximity-ranked available responders (`GET /api/admin/responders/recommendations`).
3. Administrator dispatches a responder (`POST /api/admin/responders/assign`), creating a `rescue_assignments` row and enabling an assignment-linked private conversation.
4. Responder accepts the assignment, navigates via the Leaflet/OSRM map, and updates status (`En Route` → `On Scene` → `Completed`) via `PATCH /api/responder/assignments/:id/status`.
5. Completing the assignment updates `rescue_requests`, records completion timestamps, and locks the associated chat conversation to read-only.

### Broadcast Alerts
1. Administrator opens `#section-alerts`, selects category, urgency/advisory type, target scope/zones, and expiration duration.
2. Submitting (`POST /api/admin/broadcasts`) persists the alert in `emergency_broadcast_logs` with a computed `expires_at` timestamp and emits it via Socket.IO.
3. Authorized recipients receive the alert in real time on `hazard-alerts.html` and `responder-alerts.html`.
4. Every 10 seconds, `broadcastExpirationService.js` expires any active broadcast whose `expires_at <= NOW()`, emits `alert:expired`, and preserves the record as `Expired` in Administrator broadcast history.

### Messaging
1. When an assignment links a Resident and Responder, a conversation record (`conversations` + `conversation_participants`) is used for private messaging.
2. Messages are persisted in `messages`, unread states in `message_read_status`, and delivered in real time via Socket.IO room `conversation:<id>`.
3. Either participant can archive (`PATCH /api/messages/conversations/:id/archive`) or unarchive (`PATCH /api/messages/conversations/:id/unarchive`) the conversation for their own inbox only; Administrator oversight remains unaffected.
4. If a new message arrives in an archived conversation, `messageService.js` automatically clears `is_archived` for that recipient and updates unread counts.
5. Once the rescue request or assignment reaches `Completed` / `Closed`, `messageService.js` blocks new message sends (`Conversation Closed – Assignment Completed`) while preserving read-only history.

---

## 5. Technology Stack and Architecture

### Installed Dependencies & Versions

- **Backend (`backend/package.json`):**
  - `express` (`^4.21.0`) — HTTP REST API, static portal serving, and HTML session/RBAC guards
  - `socket.io` (`^4.7.5`) — Authenticated WebSocket real-time alerts, assignment updates, and messaging
  - `pg` (`^8.23.1`) — PostgreSQL client pool (primary database driver when `DB_PORT=5432` or `DB_CLIENT=pg`)
  - `mysql2` (`^3.11.0`) — Supported via dual-dialect SQL compatibility layer in `backend/config/db.js`
  - `jsonwebtoken` (`^9.0.2`) — HS256 JWT authentication tokens
  - `bcrypt` (`^5.1.1`) — Password hashing (cost factor `10`)
  - `express-validator` (`^7.2.0`) — Request payload validation
  - `cors` (`^2.8.5`) — Cross-origin resource sharing
  - `dotenv` (`^16.6.1`) — Environment variable loading
- **Frontend (`frontend/package.json` & vendored assets):**
  - **HTML5, CSS3, Vanilla JavaScript (ES6+)** — Multi-page portal architecture
  - **Tailwind CSS (`^3.4.17`)** — Utility styling compiled from `frontend/src/input.css` to `frontend/assets/css/style.css`
  - **Leaflet.js (`v1.9.4`)** — Interactive maps (`frontend/assets/vendor/leaflet/`)
  - **Lucide Icons** — UI iconography (`frontend/assets/vendor/lucide/lucide.min.js`)
  - **Browser Geolocation API** & **MediaDevices / File Photo Capture** — GPS coordinates and camera photo evidence
- **External Mapping & Routing Providers (`frontend/assets/js/mapping-service.js`):**
  - **OpenStreetMap Tiles:** `https://tile.openstreetmap.org/{z}/{x}/{y}.png`
  - **Project-OSRM Foot Routing:** `https://router.project-osrm.org/route/v1/foot`
  - **OSM Nominatim Reverse Geocoding:** `https://nominatim.openstreetmap.org/reverse` (throttled to `<= 1 req/sec`)

### Architecture Flow

The Express backend (`backend/server.js`) serves both the `/api` and `/api/v1` REST APIs, Socket.IO real-time server (`socketService.js`), server-side HTML portal authentication/RBAC guards, protected `/assets/uploads` file delivery, and static frontend files from `../frontend`. Queries pass through `backend/config/db.js`, which connects to PostgreSQL (`geosafe_db`).

---

## 6. Database Overview

- **Database Name:** `geosafe_db` (PostgreSQL 18; schema defined in `database/geosafe_db_postgres.sql`)

### Main Tables

| Category | Tables | Purpose |
| :--- | :--- | :--- |
| **Users & RBAC** | `roles`, `role_sequences`, `users`, `user_profiles`, `responder_profiles`, `account_status_history` | Canonical 3-role RBAC (`1=Administrator`, `2=Responder`, `3=Resident`), sequential role codes, resident/responder profiles, location verification status, and account status changes. |
| **Incidents & History** | `incident_categories`, `reports`, `incident_attachments`, `incident_status_history`, `incident_assignments`, `incident_updates` | Submitted incident reports, stored photo metadata, verification/closure status transitions, responder assignments, and field updates. |
| **Rescue Operations** | `rescue_requests`, `rescue_assignments`, `rescue_attachments`, `rescue_updates`, `rescue_status_history`, `responder_assignment_history` | Emergency rescue requests, dispatch assignments, operational timestamps, attachments, and progress/status audit trails. |
| **Evacuation & Facilities** | `evacuation_centers`, `evacuation_center_facilities`, `hospitals`, `evacuation_routes`, `evacuation_route_waypoints` | Registered Barangay Bayanan evacuation centers, facilities, nearby hospitals, and mapped evacuation routes with ordered waypoints. |
| **Alerts & Notifications** | `alerts`, `emergency_broadcast_logs`, `notifications`, `notification_recipients` | Emergency broadcasts with `expires_at`, `expired_at`, `status`, and `is_active` lifecycle fields, plus targeted user notifications. |
| **Messaging** | `conversations`, `conversation_participants`, `messages`, `message_read_status` | Assignment-linked conversations, per-user `is_archived` state, message history, and per-user read tracking. |
| **Security & Config** | `audit_logs`, `auth_security_logs`, `system_settings` | Administrative action trails, login/unauthorized access security logs, and configurable operational key-value settings. |

---

## 7. Installation and Local Setup

### Prerequisites

- **Node.js** (v18+ recommended; verified with Node v26) and **npm**
- **PostgreSQL 18** (running on port `5432`)

### 1. Install Dependencies

```bash
cd backend
npm install

cd ../frontend
npm install
npm run build:css
```

### 2. Configure Environment Variables

Create `backend/.env` based on `backend/.env.example` using safe, private values (never commit `.env`):

```env
PORT=3000
JWT_SECRET=replace-with-a-long-random-secret
DB_CLIENT=pg
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your-postgres-password
DB_NAME=geosafe_db
```

### 3. Initialize PostgreSQL Database

Create the `geosafe_db` database in PostgreSQL and apply the schema:

```bash
psql -U postgres -c "CREATE DATABASE geosafe_db;"
psql -U postgres -d geosafe_db -f database/geosafe_db_postgres.sql
```

Optionally provision an initial Administrator account:

```bash
cd backend
npm run create-admin
```

### 4. Start the Application

```bash
cd backend
npm start
```

- **Default Port:** `3000` (configured via `PORT` in `backend/.env`).
- **Local Access:** `http://localhost:3000/login.html`
- **LAN Access:** `backend/server.js` binds to `0.0.0.0:3000` and logs detected LAN IPv4 addresses (`http://<LAN-IP>:3000`) on startup.
- **Development Watch Mode:** `npm run dev` inside `backend/`, and `npm run watch:css` inside `frontend/` for Tailwind CSS rebuilds.
- **Optional Standalone Static Proxy (`frontend/server.js`):** `npm start` inside `frontend/` serves static files and proxies `/api/*` requests to `BACKEND_HOST:BACKEND_PORT` (defaults to `localhost:3000`).

### Troubleshooting

- **`Could not verify roles table` on startup:** Ensure `database/geosafe_db_postgres.sql` has been imported into `geosafe_db` and `DB_PORT=5432` / `DB_CLIENT=pg` are set in `backend/.env`.
- **Unstyled pages:** Run `npm run build:css` inside `frontend/` to generate `frontend/assets/css/style.css`.
- **GPS or Camera blocked on LAN IP:** Browsers restrict Geolocation and Camera APIs on non-HTTPS origins other than `localhost` (see [Section 10](#10-system-limitations-and-requirements)).

---

## 8. Project Structure

```text
geo-ong/
├── README.md
├── backend/
│   ├── package.json                 # Backend dependencies & npm scripts
│   ├── server.js                    # Express app, Socket.IO init, HTML RBAC guards, protected /assets/uploads
│   ├── socket.js                    # Socket entrypoint wrapper
│   ├── .env.example                 # Environment variable template (no real secrets)
│   ├── config/                      # Database pool/dialect bridge, roles, EOC/arrival/advisory configs
│   ├── controllers/                 # Route handlers (admin, alert, auth, evac, hospital, message, report, user)
│   ├── middleware/                  # JWT/cookie authentication (auth.js) & role enforcement (rbac.js)
│   ├── models/                      # Database model helpers
│   ├── routes/                      # Express routers mounted under /api and /api/v1
│   ├── services/                    # Socket.IO service, message service, broadcast expiration, user ID sequence
│   ├── utils/                       # Barangay Bayanan GeoJSON boundary validation
│   └── scripts/                     # Setup, admin provisioning, and verification/test scripts
├── database/
│   ├── geosafe_db_postgres.sql      # Canonical PostgreSQL schema
│   ├── migrations/                  # Incremental SQL migration scripts
│   └── verify_database.sql          # Schema verification queries
├── docs/                            # Additional architecture and database reference guides
└── frontend/
    ├── package.json                 # Tailwind CSS build scripts & standalone proxy script
    ├── tailwind.config.js           # Tailwind configuration
    ├── src/input.css                # Tailwind source stylesheet
    ├── *.html                       # Role portals (admin.html, index.html, responder-*.html, login.html, etc.)
    ├── sw.js                        # Installable PWA service worker (pass-through fetch; no offline cache)
    ├── manifest.json                # Web app manifest
    └── assets/
        ├── css/style.css            # Compiled Tailwind CSS
        ├── data/                    # barangay-bayanan-boundary.geojson
        ├── js/                      # Portal controllers, mapping-service.js, store.js, components.js
        └── vendor/                  # Local Leaflet 1.9.4 and Lucide icon assets
```

---

## 9. Security and Data Handling

- **Authentication & Session Handling:** `authController.js` issues HS256 JWTs (`jsonwebtoken`) stored in an `HttpOnly`, `SameSite=Lax` cookie (`geosafe_session`) and verified on both API requests (`authenticate` middleware) and HTML page navigation (`backend/server.js`).
- **Password Hashing & Rotation:** Passwords are hashed using `bcrypt` with 10 salt rounds. Admin-provisioned accounts set `must_change_password = TRUE`, forcing a redirect to `/change-password.html` before portal access.
- **Role-Based Access Control (RBAC):** `req.user.role` is derived from database `users.role_id`—never from client-supplied token role strings—and enforced by `requireRole(...)` (`rbac.js`).
- **Protected Photo Attachments:** `backend/server.js` intercepts `/assets/uploads/(incidents|rescues)/:file`, prevents path traversal, and authorizes access only for Administrators, Responders, or the Resident who owns the parent report/rescue record.
- **Private Messaging Controls:** `messageService.js` verifies conversation participation on both REST endpoints and Socket.IO `join-conversation` / typing events, restricts Administrators to read-only oversight, and blocks sends on completed/closed rescue conversations.
- **Input Validation & Audit Trail:** `express-validator` validates registration, login, reporting, and admin user/broadcast payloads; administrative mutations and security blocks are recorded in `audit_logs` and `auth_security_logs`.
- **Known Security Limitations:**
  - `backend/server.js` runs plain HTTP on `0.0.0.0:3000`; TLS termination (e.g., via Nginx/reverse proxy) is required for encrypted transport and `Secure` cookie flags in production.
  - `cors({ origin: true, credentials: true })` reflects any request origin; production deployments should restrict `origin` to the deployed domain.
  - `geosafe_user` cookie (non-HttpOnly) is used alongside `geosafe_session` for client UI state.

---

## 10. System Limitations and Requirements

- **Network & Internet Dependency:** Active network connectivity is required. OpenStreetMap tiles, Project-OSRM pedestrian routing, and OSM Nominatim reverse geocoding require internet access; local LAN deployments without internet will not load external map tiles or OSRM routes.
- **No Offline Mode:** `frontend/sw.js` is installable-only and explicitly performs pass-through network fetches with no offline caching.
- **HTTPS Requirement for GPS & Camera on LAN/Mobile:** Modern browsers require a secure context (`HTTPS` or `http://localhost`) for `navigator.geolocation` and camera (`getUserMedia`) access. Accessing the server over plain `http://<LAN-IP>:3000` on a phone or external device will block live GPS and camera capture unless served behind HTTPS.
- **GPS Accuracy Limitations:** Browser geolocation accuracy depends on device hardware (mobile GPS vs. desktop Wi-Fi/IP estimation) and environmental conditions.
- **Mapping & Geocoding Rate Limits:** OSM Nominatim reverse geocoding enforces strict rate limits; `mapping-service.js` throttles requests to `<= 1 req/sec` and caches results in session/memory.
- **Real-Time Communication:** Socket.IO real-time notifications, live responder tracking, and instant chat updates require an active WebSocket/HTTP long-polling connection to the Node.js server.
