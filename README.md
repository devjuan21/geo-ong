# GeoSafe: A Web-Based Disaster Reporting and Emergency Assistance System for Real-Time Response in Barangay Bayanan, Muntinlupa City

> **Target Community:** Barangay Bayanan, Muntinlupa City, Metro Manila, Philippines  
> **Official EOC Location:** GeoSafe Emergency Operations Center (Bayanan Barangay Hall) — Bayanan Baywalk Ilaya, Muntinlupa, Metro Manila, Philippines (`14.41141, 121.05130`)

GeoSafe is a web-based disaster reporting, emergency rescue dispatch, evacuation routing, and real-time hazard advisory platform built for Barangay Bayanan. It connects **Residents**, **Responders**, and **Administrators** through a Node.js + Express REST API, Socket.IO real-time messaging, Leaflet GIS mapping, and a PostgreSQL (`geosafe_db`) relational database.

---

## 1. Project Overview

### System Description
GeoSafe provides an integrated operational platform where Barangay Bayanan residents can report hazards and submit emergency rescue requests with GPS coordinates, field responders can receive dispatch assignments and navigate to scenes, and Barangay Disaster Risk Reduction and Management Committee (BDRRMC) administrators can verify reports, dispatch responders, manage evacuation centers, and broadcast categorized emergency advisories.

### Purpose and Objectives
- **Accurate Geolocation Reporting:** Capture browser GPS coordinates (`latitude`, `longitude`, accuracy in meters, and capture timestamp) with Barangay Bayanan boundary verification rather than relying on approximate IP or static default locations.
- **Real-Time Multi-Role Coordination:** Synchronize incident verification, rescue dispatches, status transitions, and emergency broadcasts across connected Administrator, Responder, and Resident sessions via Socket.IO.
- **Role-Based Security & Accountability:** Enforce strict server-side authentication, role-based access control (RBAC), first-login password rotation for newly provisioned Responders, and immutable audit/security logging.
- **Local Network & Offline Resilience:** Bind the server to `0.0.0.0:3000` for multi-device LAN operation and provide a local Leaflet v1.9.4 bundle with an offline Barangay Bayanan grid tile fallback.

### Intended Users and Stakeholders
- **Residents of Barangay Bayanan:** Submit incident reports and rescue requests, monitor the Community Map, view categorized Hazard Alerts, and navigate to the nearest open Evacuation Center.
- **Barangay Bayanan Emergency Response Team (Responders):** Receive dispatched assignments, view verified active incidents on the Operations Map, update field status (`Responding`, `On Scene`, `Completed`), and receive EOC broadcast alerts.
- **BDRRMC Administrators (EOC Personnel):** Triage incoming reports and rescue requests, verify/reject submissions, dispatch responders, provision responder accounts, manage evacuation centers and system settings, and issue categorized emergency broadcasts.

---

## 2. System Features

### Resident Portal
- **Dashboard & Community Map (`index.html`, `home.js`):** Interactive Leaflet Community Map showing active verified public incidents (`INC-*`), user GPS position, and Barangay Bayanan boundary; **Recent Reports** list; clickable **Hazard Alerts** card displaying prioritized active advisories with category badges; GPS-computed **Nearest Evacuation Center** widget; and **Report / Rescue** and **My Submitted Reports** navigation cards.
- **Incident Reporting & Rescue Requests (`report-rescue.html`, `report-rescue.js`):** Unified submission workflow for **Incident Reports** and **Rescue Requests** (people trapped count, special vulnerabilities, landmark, photo attachments saved under `frontend/assets/uploads/`, and live GPS capture or manual map pin selection).
- **Rescue Requests Tracker (`rescue-requests.html`, `rescue-requests.js`):** Tracks active and historical rescue requests, status timeline, and resident confirmation of rescue completion.
- **Hazard Alerts (`hazard-alerts.html`, `hazard-alerts.js`):** Full advisory listing with database-driven category filtering, status filtering (`Active & Expired` or `Include Archived`), priority/newest sorting, emergency visual highlighting, and a detail modal showing message, target scope/zones, publisher, and timestamp.
- **Evacuation Centers & Routes (`evacuation-centers.html`, `evacuation-routes.html`):** Directory of Barangay Bayanan evacuation centers with occupancy/capacity details and interactive pedestrian routing via Project-OSRM (with offline straight-line/distance fallback).
- **Notifications, Profile & Settings (`notifications.html`, `profile.html`, `settings.html`):** Per-user notification center with category badges and read/unread tracking, resident profile/medical notes, and account settings.

### Responder Portal
- **Responder Dashboard (`responder-dashboard.html`, `responder-dashboard.js`):** Live dispatch statistics (`Active Tasks`, `Pending`, `In Progress`, `Resolved`), active field assignments feed, duty availability switcher (`On Duty`, `Unavailable`, `Off Duty`), and an Operational Map preview centered on the official EOC (`14.41141, 121.05130`).
- **Field Assignments (`responder-assignments.html`, `responder-assignments.js`):** Manage assigned incident reports and rescue requests, submit progress updates, attach field evidence, confirm on-scene arrival (with Haversine distance validation via `arrivalConfig.js`), and mark operations completed.
- **Operations Map (`responder-map.html`, `responder-map.js`):** Full-screen operational map displaying assigned tasks, active verified community incidents, evacuation shelters, emergency facilities/hospitals, the official EOC marker, filter pills (`All`, `Rescues`, `Incidents`, `Shelters`), live responder GPS tracking, and route calculation.
- **Notifications & Profile (`responder-ui.js`, `responder-profile.html`):** Real-time header notification bell with unread indicator, expandable broadcast/dispatch detail view, per-notification read tracking, and mandatory first-login password change (`change-password.html`).

### Administrator Dashboard (`admin.html`, `admin.js`)
- **Command Overview & Live Map:** Real-time operational counters (`Total Reports`, `Pending Review`, `Verified Incidents`, `Active Rescues`, `Available Responders`, `Registered Residents`), interactive map showing active incidents, active rescues, evacuation centers, and the official EOC marker, plus recent activity feed.
- **Report & Rescue Triage:** Review incident reports and rescue requests, inspect attachments and GPS accuracy, verify or reject reports (`Verify`, `Reject`), update statuses, and mark incidents resolved (automatically removing them from all active maps while preserving historical records).
- **Responder Dispatch:** Assign active `On Duty` responders to open incidents or rescue requests with duplicate-dispatch prevention (`409` conflict guard).
- **User & Responder Governance:** Review resident location verification, manage user account statuses, and provision Responder accounts (`POST /api/admin/users/responders`) with server-generated temporary passwords (`must_change_password = TRUE`).
- **Categorized Emergency Broadcast Dispatch:** Select a database-driven **Advisory Category** (or add new categories via `+ Add Category`), target audience scope (`All Barangay Bayanan`, `Lakeshore Zone`, `Specific Purok`, `Responders Only`), affected zones, title, and message; preview before transmitting; persist to `emergency_broadcast_logs`, `alerts`, `notifications`, and `notification_recipients`; and review **Emergency Broadcast History**.
- **Analytics, Audit Logs & System Settings:** Operational analytics with CSV export, immutable audit log viewer, and editable `system_settings` (including GPS accuracy threshold and Official EOC Location coordinates).

---

## 3. User Roles and Permissions

GeoSafe enforces three canonical roles stored in `roles` (`backend/config/roles.js`) and checked on every request by `authenticate` (`backend/middleware/auth.js`) and `requireRole` (`backend/middleware/rbac.js`):

| Role | `role_id` | Default Portal | Permissions & Access Scope |
| :--- | :---: | :--- | :--- |
| **Administrator** | `1` | `/admin.html` | Full access to `/api/admin/*` (dashboard overview, report/rescue triage, responder dispatch, user & responder provisioning, broadcast categories & dispatch, analytics, audit logs, system settings). Cannot self-register via `/api/register`. |
| **Responder** | `2` | `/responder-dashboard.html` | Access to `/api/responder/*`, assigned tasks, field status updates, notifications, and `/api/eoc-location`. Newly created Responders with `must_change_password = TRUE` are blocked (`403 PASSWORD_CHANGE_REQUIRED` / `302 -> /change-password.html`) from all operational APIs and portal pages until they replace their temporary password. |
| **Resident** | `3` | `/index.html` | Public self-registration (`/api/register`). Access to resident dashboard, own reports/rescues, public verified community incidents (`/api/reports/public`), hazard alerts (`/api/hazard-alerts`), evacuation centers/routes, notifications, and profile. Blocked from `/api/admin/*` and `/api/responder/*`. |

---

## 4. System Architecture

| Layer | Technologies & Implementation |
| :--- | :--- |
| **Frontend** | Semantic HTML5, Tailwind CSS (`frontend/src/input.css` compiled to `frontend/assets/css/style.css`), Vanilla JavaScript (`frontend/assets/js/*`), **Leaflet v1.9.4** (local vendor bundle), **Socket.IO** client |
| **Backend** | **Node.js** + **Express v4.21.0** (`backend/server.js`), **Socket.IO v4.7.5** (`backend/services/socketService.js`), `express-validator`, `cors`, `dotenv` |
| **Database** | **PostgreSQL** (`geosafe_db`) accessed via `pg.Pool` with SQL query compatibility wrapper (`backend/config/db.js`, `backend/models/db.js`) |
| **Authentication & Security** | `bcrypt` password hashing, `jsonwebtoken` (HS256) stored in `HttpOnly` cookie `geosafe_session`, double-submit CSRF cookie/header (`geosafe_csrf` / `X-CSRF-Token`), in-memory JTI revocation on logout/password rotation, server-side HTML portal route protection in `backend/server.js` |
| **Real-Time Messaging** | Authenticated Socket.IO connections joined to `user:<id>`, `role:<role>`, and `broadcast` rooms; targeted emissions for `new-incident-report`, `public-report-verified`, `incident-resolved`, `new-rescue-request`, `rescue-assignment-updated`, `rescue-status-updated`, `new-hazard-alert`, `alert-broadcast`, and `administrator-announcement` (excluding self-actor notifications) |
| **Mapping & GIS** | Leaflet v1.9.4, OpenStreetMap tiles (with automatic offline SVG/Grid fallback), Nominatim reverse-geocoding (with offline Bayanan approximation fallback), Project-OSRM pedestrian routing (with offline Haversine fallback), and official Barangay Bayanan GeoJSON polygon (`frontend/assets/data/barangay-bayanan-boundary.geojson`) |

### API Structure
All REST endpoints are mounted under both `/api` and `/api/v1`:
- `authRoutes.js`: `/login`, `/register`, `/verify-location`, `/auth/session`, `/auth/change-password`, `/logout`
- `reportRoutes.js`: Incident report creation, attachment retrieval, and status endpoints
- `alertRoutes.js`: Alert retrieval endpoints
- `userRoutes.js`: User profile endpoints
- `adminRoutes.js`: `/api/admin/*` command, triage, dispatch, user/responder governance, broadcast categories & broadcasts, analytics, audit logs, and settings
- `evacRoutes.js` & `hospitalRoutes.js`: Evacuation center and emergency facility/hospital endpoints
- `portalRoutes.js`: Resident and Responder portal endpoints (`/dashboard/summary`, `/reports/public`, `/rescue-requests`, `/notifications`, `/broadcast-categories`, `/hazard-alerts`, `/evacuation-routes`, `/eoc-location`, `/responder/*`)

---

## 5. Database Documentation (`PostgreSQL` — `geosafe_db`)

The live `geosafe_db` PostgreSQL database contains **31 tables** protected by `ON DELETE RESTRICT` foreign keys and PL/pgSQL immutability triggers (`fn_prevent_audit_modification()`) on audit and history tables.

### Tables by Functional Domain
- **Identity, Roles & Security:**
  - `roles` (canonical 1=Administrator, 2=Responder, 3=Resident)
  - `role_sequences` (auto-incrementing `user_code` prefixes such as `RSPDR-XXXX`)
  - `users` (`id`, `user_code`, `name`, `email`, `password_hash`, `role_id`, `role`, `status`, `account_status`, `must_change_password`, `last_login_at`)
  - `user_profiles` (`user_id`, name parts, `phone_number`, `street_address`, `location_verification_status`, `location_accuracy_meters`, `emergency_contact_*`, `medical_notes`)
  - `responder_profiles` (`user_id`, `badge_number`, `callsign`, `assigned_unit`, `department`, `designation`, `service_id`, `availability_status`, `current_latitude`, `current_longitude`)
  - `account_status_history`, `auth_security_logs`, `audit_logs`
- **Incident Reporting & Triage:**
  - `incident_categories`, `reports` (`reference_number`, `user_id`, `category_id`, `incident_type`, `latitude`, `longitude`, `address`, `status`, `is_public`, `assigned_to`, `verified_by`, `resolved_at`), `incident_attachments`, `incident_assignments`, `incident_status_history`, `incident_updates`
- **Rescue Requests & Dispatch:**
  - `rescue_requests` (`reference_number`, `user_id`, `emergency_type`, `people_count`, `vulnerable_details`, `latitude`, `longitude`, `address`, `landmark`, `status`, `confirmed_by`), `rescue_attachments`, `rescue_assignments`, `rescue_status_history`, `rescue_updates`, `responder_assignment_history`
- **Broadcasts, Alerts & Notifications:**
  - `broadcast_categories` (`id`, `name`, `slug`, `badge_color`, `priority`, `description`, `is_active`)
  - `emergency_broadcast_logs` (`id`, `title`, `message`, `category_id`, `advisory_type`, `severity`, `target_scope`, `target_zones`, `recipients_count`, `authorized_by`, `broadcasted_at`, `expires_at`, `is_active`)
  - `alerts`, `notifications` (`id`, `title`, `message`, `category`, `advisory_type`, `severity`, `created_by`), `notification_recipients` (`notification_id`, `user_id`, `is_read`, `read_at`, unique on `(notification_id, user_id)`)
- **Evacuation, Facilities & Configuration:**
  - `evacuation_centers`, `evacuation_center_facilities`, `evacuation_routes`, `evacuation_route_waypoints`, `hospitals`, `system_settings`

### Key Foreign Key Relationships
- `users.role_id -> roles.id`
- `user_profiles.user_id -> users.id`, `responder_profiles.user_id -> users.id`
- `reports.user_id -> users.id`, `reports.verified_by -> users.id`, `reports.assigned_to -> users.id`, `reports.category_id -> incident_categories.id`
- `incident_assignments.report_id -> reports.id`, `incident_assignments.responder_user_id -> users.id`
- `rescue_assignments.rescue_id -> rescue_requests.id`, `rescue_assignments.responder_user_id -> users.id`
- `emergency_broadcast_logs.category_id -> broadcast_categories.id`, `emergency_broadcast_logs.authorized_by -> users.id`
- `notification_recipients.notification_id -> notifications.id`, `notification_recipients.user_id -> users.id`
- `evacuation_routes.destination_center_id -> evacuation_centers.id`

---

## 6. Installation and Configuration

### Prerequisites
- **Node.js** (v18+ recommended; verified on Node.js v26.13.0)
- **PostgreSQL** (running locally or accessible on network)

### 1. Database Setup
1. Execute `database/geosafe_db_postgres.sql` in PostgreSQL to create `geosafe_db`, tables, triggers, canonical roles, and Barangay Bayanan evacuation centers/routes/hospitals.
2. Apply incremental SQL files in `database/migrations/` if upgrading an older schema, and optionally run `database/verify_database.sql`.

### 2. Backend Environment Configuration
```powershell
cd backend
Copy-Item .env.example .env
```
Configure `backend/.env`:
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

### 3. Install Dependencies & Provision Initial Admin
```powershell
cd backend
npm install
npm run create-admin
```

### 4. Build Frontend Styles (Optional when modifying CSS/HTML)
```powershell
cd frontend
npm install
npm run build
```

### 5. Start the Application
```powershell
cd backend
npm start
```
Access GeoSafe at **`http://localhost:3000/login.html`** (or `http://<LAN-IP>:3000/login.html` on the same local network).

---

## 7. System Workflows

1. **Resident Registration & Location Verification:** Resident submits registration on `login.html` -> optional pre-registration GPS verification via `POST /api/verify-location` checks coordinates against the Barangay Bayanan polygon and `gps_accuracy_threshold_meters` -> account created with `role_id = 3`.
2. **Responder Provisioning & First-Login Password Change:** Admin creates Responder via `POST /api/admin/users/responders` -> server generates random temporary password, stores `bcrypt` hash, and sets `must_change_password = TRUE` -> Responder logs in -> middleware and HTML route guards force redirect to `/change-password.html` until `POST /api/auth/change-password` updates the hash, sets `must_change_password = FALSE`, and rotates the session token.
3. **Incident Reporting & Triage:** Resident submits incident with live GPS coordinates (`POST /api/reports`) -> Admin reviews in `admin.html` and marks `Verified` or `Rejected` -> verified reports appear on Resident Community Map (`/api/reports/public`), Responder Operations Map (`/api/responder/map-data`), and Admin Map (`/api/admin/overview`) -> marking `Resolved` removes the marker in real time via `incident-resolved` Socket.IO event while keeping PostgreSQL history intact.
4. **Rescue Request & Dispatch:** Resident submits rescue request -> Admin dispatches an active `On Duty` Responder -> Responder receives real-time assignment notification, navigates to scene, confirms arrival, and marks `Completed` -> completed rescue is removed from active maps and preserved in history.
5. **Categorized Emergency Broadcast Dispatch:** Admin selects a database category from `broadcast_categories`, audience scope, affected zones, title, and message -> previews in confirmation modal -> `POST /api/admin/broadcasts` persists to `emergency_broadcast_logs`, `alerts`, `notifications`, `notification_recipients`, and `audit_logs` inside a transaction -> Socket.IO delivers targeted real-time alerts to eligible active Residents and Responders (excluding the broadcasting Admin).
6. **Evacuation Center Navigation:** Resident Dashboard computes distance from the resident's live GPS to open PostgreSQL evacuation centers and links to `evacuation-routes.html` for turn-by-turn/polyline routing.

---

## 8. Map and EOC Configuration

- **Map Provider & Routing:** Uses **Leaflet v1.9.4** (`frontend/assets/vendor/leaflet/`) with OpenStreetMap tiles, Nominatim reverse-geocoding, Project-OSRM pedestrian routing, and an offline SVG/grid fallback when offline.
- **Community Map:** Displays verified active public incidents (`INC-*`), Resident live GPS position (when permitted), and Barangay Bayanan boundary.
- **Official GeoSafe EOC Location:**
  - **Name:** `GeoSafe Emergency Operations Center (Bayanan Barangay Hall)`
  - **Address:** `Bayanan Barangay Hall, Bayanan Baywalk Ilaya, Muntinlupa, Metro Manila, Philippines`
  - **Latitude / Longitude:** `14.41141, 121.05130`
  - **Storage & Usage:** Stored in PostgreSQL `system_settings` (`eoc_location_name`, `eoc_address`, `eoc_latitude`, `eoc_longitude`), exposed via `/api/eoc-location`, `/api/admin/overview`, and `/api/responder/map-data`, and displayed as a distinct **`EOC`** marker on Administrator and Responder maps. This represents the physical command center and is **never** substituted for a Resident's or Responder's live GPS location.

---

## 9. Capstone Paper Reference (Chapters 3 & 4)

### Implemented Modules Summary
- **Authentication & RBAC Module:** Session cookies, CSRF protection, JTI revocation, server-side HTML route protection, mandatory Responder first-login password change.
- **Incident & Rescue Operations Module:** GPS-backed submissions, attachment uploads, Admin triage & dispatch, Responder status progression, arrival distance check, real-time Socket.IO sync, resolved/completed map exclusion with historical preservation.
- **Emergency Broadcast & Notification Module:** Dynamic `broadcast_categories` taxonomy, scope/zone targeting, transactional persistence, per-recipient read/unread state, Hazard Alerts filtering/sorting/detail modal.
- **GIS Mapping & Evacuation Module:** Custom Rescue/Incident/Evacuation/EOC markers, Barangay Bayanan GeoJSON boundary verification, nearest evacuation center calculation, OSRM routing.
- **Governance & Audit Module:** Immutable `audit_logs` and `auth_security_logs`, CSV analytics export, database-backed `system_settings`.

### Known Limitations & Planned / Unimplemented Features
- **Browser Geolocation on Non-HTTPS LAN:** Modern browsers restrict `navigator.geolocation` on non-localhost HTTP origins (`http://<LAN-IP>:3000`); GeoSafe handles this by prompting manual map-pin selection or HTTPS/localhost usage.
- **External SMS / Push Gateways:** Delivery currently operates over web notifications, Hazard Alerts, and Socket.IO; carrier SMS and native mobile push notifications are not integrated.
- **Real-Time Map Tiles Offline:** While Leaflet has an offline grid fallback (`L.GridLayer`), detailed street-level OSM tiles and OSRM road routing require internet connectivity.
- **Automated Broadcast Expiration Scheduler:** `expires_at` is evaluated on read (`Expired` status when past `expires_at`), without a background cron daemon archiving expired rows automatically.
