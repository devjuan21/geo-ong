# GeoSafe — Supabase Deployment Guide

This folder contains everything required to initialize and verify GeoSafe's **PostgreSQL database** and **private Storage buckets** on [Supabase](https://supabase.com/), and connect it to the existing Node.js/Express backend (for example, hosted on Render).

> **Important Note on Current Integration Status:**
> - **PostgreSQL Database:** Ready to connect via [backend/config/db.js](../backend/config/db.js) using `DB_SSL=true` (or `DATABASE_URL`).
> - **Photo Storage:** The SQL scripts below provision the 3 private Supabase Storage buckets and RLS policies. However, GeoSafe's Express upload handlers (`backend/routes/portalRoutes.js` and `backend/controllers/reportController.js`) currently write uploaded files to local disk (`frontend/assets/uploads/`) by default; to persist photos in Supabase Storage across ephemeral container restarts (such as Render Free tier), wire the server-side `@supabase/supabase-js` client using `SUPABASE_SERVICE_ROLE_KEY` in the backend upload handlers.
> - **Never** expose `SUPABASE_SERVICE_ROLE_KEY` in any `frontend/` file.

---

## Folder Contents

| File | Purpose | How to Run |
|---|---|---|
| `migrations/001_initial_schema.sql` | Canonical PostgreSQL schema (`database/geosafe_db_postgres.sql`) | **Supabase CLI** (`supabase db push`) or **SQL Editor** (Step 4a) |
| `migrations/002_incremental_migrations.sql` | Idempotent incremental updates (`010`, `013`, `017`) not yet in `001` | **Supabase CLI** or **SQL Editor** (Step 4b) |
| `storage/001_storage_buckets.sql` | Creates private buckets (`incident-evidence`, `rescue-evidence`, `rescue-completion-evidence`) | **SQL Editor manually** (Step 5a) |
| `storage/002_storage_policies.sql` | Enables RLS & strict access policies on `storage.objects` | **SQL Editor manually** (Step 5b) |
| `setup/verification_queries.sql` | Read-only SQL checks for tables, roles, FKs, indexes, constraints, buckets & policies | **SQL Editor manually** (Step 7) |
| `.env.example` | Template environment variables (placeholders only — no secrets) | Copy values to Render / `backend/.env` |

---

## Step-by-Step Deployment

### 1. Create a Supabase Project
1. Sign in at [supabase.com](https://supabase.com/) and click **New Project**.
2. Choose your organization, name the project (e.g., `geosafe-bayanan`), choose a strong database password, and select the region closest to the Philippines (e.g., **Southeast Asia (Singapore)** `ap-southeast-1`).
3. Wait ~2 minutes for the database to finish provisioning.

### 2. Locate PostgreSQL Connection Details
1. In your Supabase dashboard, click **Connect** (top bar) or go to **Project Settings → Database**.
2. Under **Connection string / Pooler**, choose **Session Pooler** (IPv4-compatible, port `5432`) or **Direct Connection** if your host supports IPv6.
3. Note your `Host`, `Port` (`5432`), `Database` (`postgres`), `User` (e.g. `postgres.<project-ref>`), and your database password.

### 3. Configure Database SSL & Connection Settings
GeoSafe's [backend/config/db.js](../backend/config/db.js) supports both local PostgreSQL (`DB_SSL=false` or unset) and Supabase (`DB_SSL=true` or `DATABASE_URL` containing `supabase.`).

Use the template in [supabase/.env.example](./.env.example):
- Set `DB_CLIENT=pg`
- Set `DB_HOST`, `DB_PORT=5432`, `DB_USER`, `DB_PASSWORD`, `DB_NAME=postgres`
- Set `DB_SSL=true`

### 4. Execute SQL Migrations in Order
#### Option A — Using Supabase SQL Editor (Recommended for Beginners)
1. Open **SQL Editor → New Query** in the Supabase dashboard.
2. Paste the entire contents of `supabase/migrations/001_initial_schema.sql` and click **Run**.
3. Open a new query, paste `supabase/migrations/002_incremental_migrations.sql`, and click **Run**.

#### Option B — Using Supabase CLI (Migrations Only)
1. Link your project: `supabase link --project-ref <your-project-ref>`
2. Push `supabase/migrations/`: `supabase db push`
3. *(Storage scripts in `supabase/storage/` and verification queries in `supabase/setup/` should still be executed in the SQL Editor.)*

### 5. Configure Private Storage Buckets & Policies
1. In the Supabase **SQL Editor**, run `supabase/storage/001_storage_buckets.sql` to create the 3 private (`public = false`) buckets:
   - `incident-evidence`
   - `rescue-evidence`
   - `rescue-completion-evidence`
2. Next, run `supabase/storage/002_storage_policies.sql` to enforce Row Level Security on `storage.objects`.
3. Find your `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` under **Project Settings → API**. Keep `SUPABASE_SERVICE_ROLE_KEY` strictly on the backend.

### 6. Configure Render Environment Variables
1. Create a **Web Service** on Render pointing to `backend/` (`Build Command: npm install`, `Start Command: node server.js`).
2. Add all variables from `supabase/.env.example` under **Environment → Environment Variables** in Render (with real values, never committed to Git).
3. Provision your initial Administrator account once against the Supabase database:
   ```bash
   node backend/scripts/create-admin.js
   ```

### 7. Test Database Connectivity & Structure
1. Run `supabase/setup/verification_queries.sql` in the Supabase SQL Editor and confirm:
   - All expected tables exist in `public`.
   - The 3 canonical roles (`Administrator`, `Responder`, `Resident`) exist in `roles`.
   - `user_profiles.location_verification_status` and `reports.source_rescue_id` exist.
   - All 3 private buckets appear in `storage.buckets` (`public = false`) with `geosafe_*` policies in `pg_policies`.
2. Call `GET https://<your-render-app>/api/health` and confirm `{"status":"ok"}`.

### 8. Test Genuine Photo Uploads & Retrieval
1. Log in as a Resident and submit a genuine Incident Report or Rescue Request with a photo attachment.
2. Confirm the attachment record is saved in `incident_attachments` or `rescue_attachments` and renders cleanly in the Resident, Responder, and Administrator views.
3. Log in as a Responder, complete a rescue operation with a completion photo, and verify the completion evidence loads without exposing private files publicly.

### 9. Verify Existing GeoSafe Workflows
- Login for Administrator, Responder, and Resident roles
- Incident Report & Rescue Request creation + Socket.IO real-time notifications & toasts
- Responder acceptance, live GPS navigation, verification, and completion
- Leaflet maps & Barangay Bayanan boundary (`PSGC 1380800002`)
- Reports & Analytics charts + Excel/CSV/PDF exports
