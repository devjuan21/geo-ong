# GeoSafe Database Guide (`geosafe_db`)

## 1. Canonical Files (`database/`)

- **[`geosafe_db_schema.sql`](../database/geosafe_db_schema.sql)** — Self-contained MySQL schema creating `geosafe_db` with **38** InnoDB tables, **51** `ON DELETE RESTRICT` foreign keys, **27** triggers, and the **3** canonical RBAC roles (`1 = Administrator`, `2 = Responder`, `3 = Resident`).
- **[`verify_database.sql`](../database/verify_database.sql)** — Read-only verification suite for MySQL Workbench confirming all 38 tables, 51 foreign keys, 27 triggers, and zero sample/hardcoded operational rows.
- **[`migrations/`](../database/migrations/)** — Modular SQL migration scripts (`002` through `008`).
- **[`REVISION_NOTES.md`](../database/REVISION_NOTES.md)** — Fresh-database release notes and historical record protection summary.
- **[`archive/`](../database/archive/)** — Preserved SQL and ZIP backups (`database.zip`, `GeoSafe_database_corrected.zip`, `legacy_v1_schema.sql`, `legacy_v1_migration_family.sql`).

## 2. Historical Record Protection

- All 51 foreign keys use `ON DELETE RESTRICT` to prevent cascading deletion of incident reports, rescue requests, responder assignments, family memberships, consent history, notifications, and security/audit logs.
- User accounts and family groups use status-based deactivation (`account_status`, `status`, `is_active`, `deleted_at`) rather than physical row deletion.
- Immutable audit tables (`audit_logs`, `auth_security_logs`, `account_status_history`, `incident_status_history`, `rescue_status_history`, `responder_assignment_history`) are guarded by `BEFORE DELETE` triggers that block deletion.

