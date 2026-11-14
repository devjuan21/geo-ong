# GeoSafe SQL Package — Clean Database Release Notes

This SQL package (`geosafe_db`) provides both the native **PostgreSQL 16+ schema (`database/geosafe_db_postgres.sql`)** and the **MySQL 8.0+ compatibility schema (`database/geosafe_db_schema.sql`)** for the **GeoSafe: A Web-Based Disaster Preparedness and Emergency Response System for Real-Time Incident Reporting and Evacuation Route Mapping in Barangay Bayanan, Muntinlupa City**.

## Key Database Characteristics
1. **Native PostgreSQL Schema (`database/geosafe_db_postgres.sql`)**:
   - Defines all canonical tables (`roles`, `role_sequences`, `users`, `user_profiles`, `responder_profiles`, `account_status_history`, `auth_security_logs`, `audit_logs`, `incident_categories`, `reports`, `incident_attachments`, `incident_status_history`, `incident_assignments`, `incident_updates`, `rescue_requests`, `rescue_assignments`, `rescue_attachments`, `rescue_updates`, `rescue_status_history`, `responder_assignment_history`, `evacuation_centers`, `evacuation_center_facilities`, `evacuation_routes`, `evacuation_route_waypoints`, `hospitals`, `notifications`, `notification_recipients`, `alerts`, `emergency_broadcast_logs`, `weather_cache`, `tropical_cyclone_bulletins`, `system_settings`).
   - Uses native PostgreSQL types (`SERIAL`/`BIGSERIAL`, `TIMESTAMPTZ`, `JSONB`, `TEXT`, `NUMERIC`, `BOOLEAN`), `ON DELETE RESTRICT` foreign keys, and PL/pgSQL triggers (`trg_users_user_code_immutable`, `trg_users_sync_role`, `updated_at` auto-updater, and append-only audit log protection).
   - Seeds the 3 canonical RBAC roles (`1 = Administrator`, `2 = Responder`, `3 = Resident`), `role_sequences` (`ADM`, `RSPDR`, `RSDNT`), verified Barangay Bayanan evacuation centers and facilities, verified Barangay Bayanan evacuation routes and waypoints, and Muntinlupa City hospitals.
2. **MySQL 8.0+ Schema (`database/geosafe_db_schema.sql`)**:
   - Creates all **33** InnoDB base tables, **40** `ON DELETE RESTRICT` foreign keys, and **18** enforcement, synchronization, and audit-immutability triggers.
   - Completely free of any obsolete non-core tables, columns, or triggers.
3. **Read-Only Verification (`database/verify_database.sql`)**:
   - Verifies all 33 canonical tables, 40 `ON DELETE RESTRICT` foreign keys, 18 triggers, and 3 canonical RBAC roles.
