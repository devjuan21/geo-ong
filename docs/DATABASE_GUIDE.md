# GeoSafe Database Guide (`geosafe_db`)

## 1. Canonical PostgreSQL Files (`database/`)

- **[`geosafe_db_postgres.sql`](../database/geosafe_db_postgres.sql)** — Canonical PostgreSQL schema creating `geosafe_db` with **32** tables, `ON DELETE RESTRICT` foreign keys, PL/pgSQL triggers, the **3** canonical RBAC roles (`1 = Administrator`, `2 = Responder`, `3 = Resident`), and verified Barangay Bayanan evacuation centers, evacuation routes, Muntinlupa hospitals, and incident categories.
- **[`verify_database.sql`](../database/verify_database.sql)** — Read-only verification suite confirming table readiness, foreign keys, triggers, and clean initial operational state.
- **[`migrate_backup_to_postgres.js`](../database/migrate_backup_to_postgres.js)** — Helper script to initialize `geosafe_db` in PostgreSQL 18 and migrate existing `users`, `user_profiles`, `role_sequences`, `audit_logs`, and `auth_security_logs`.
- **[`migrations/`](../database/migrations/)** — Modular SQL migration scripts.
- **[`REVISION_NOTES.md`](../database/REVISION_NOTES.md)** — Fresh-database release notes and historical record protection summary.
- **[`archive/`](../database/archive/)** — Preserved SQL and JSON backup snapshots.

## 2. Historical Record Protection

- Foreign keys use `ON DELETE RESTRICT` to prevent cascading deletion of incident reports, rescue requests, responder assignments, notifications, and security/audit logs.
- User accounts use status-based deactivation (`account_status`, `status`, `is_active`) rather than physical row deletion.
- Immutable audit tables (`audit_logs`, `auth_security_logs`, `account_status_history`, `incident_status_history`, `rescue_status_history`, `responder_assignment_history`) are protected against deletion via database triggers.
