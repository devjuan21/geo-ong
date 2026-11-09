# GeoSafe SQL Package — Clean Fresh Database Release Notes

This SQL package (`geosafe_db`) is configured as a **100% fresh database installation** with zero existing operational data, zero legacy data-migration backfills, and zero hardcoded sample/reference records beyond the 3 canonical RBAC roles.

## Key Fresh-Database Characteristics
1. **Complete Single-Script Fresh Schema (`database/geosafe_db_schema.sql`)**:
   - Executes `DROP DATABASE IF EXISTS geosafe_db; CREATE DATABASE geosafe_db ...` to remove any pre-existing data or outdated tables.
   - Creates all **38** required InnoDB base tables, **51** `ON DELETE RESTRICT` foreign keys, and **27** enforcement, synchronization, and audit-immutability triggers in a single self-contained file.
2. **Zero Hardcoded or Existing Operational Data**:
   - Only the 3 required RBAC roles (`1 = Administrator`, `2 = Responder`, `3 = Resident`) are defined in `roles`.
   - All other **37** tables (`users`, `user_profiles`, `responder_profiles`, `incident_categories`, `reports`, `incident_reports`, `incident_attachments`, `incident_status_history`, `incident_assignments`, `incident_updates`, `rescue_requests`, `rescue_assignments`, `rescue_attachments`, `rescue_updates`, `rescue_status_history`, `responder_assignment_history`, `family_groups`, `family_members`, `family_invitations`, `family_join_requests`, `family_location_sharing_consents`, `family_location_updates`, `evacuation_centers`, `evacuation_center_facilities`, `evacuation_routes`, `evacuation_route_waypoints`, `hospitals`, `notifications`, `notification_recipients`, `emergency_broadcast_logs`, `alerts`, `weather_cache`, `tropical_cyclone_bulletins`, `system_settings`, `audit_logs`, `account_status_history`, `auth_security_logs`) start with **0 rows**.
   - All existing-data `UPDATE` backfills and `incident_migration_map` data-copying blocks have been removed from `migrations/002` through `008`.
3. **Frontend & Backend Hardcoded Data Removed**:
   - Removed hardcoded `SEED_USERS` (`admin@geosafe.local`, `responder@geosafe.local`) from `backend/scripts/seed.js`.
   - Removed hardcoded `emergencyContacts`, `barangayFacilities`, `responderContact`, and fallback coordinates from `assets/js/mock-data.js`, `assets/js/store.js`, and `assets/js/rescue-requests.js`.
   - Removed hardcoded `DEFAULT_REPORTS`, `DEFAULT_ALERTS`, `DEFAULT_USERS`, `DEFAULT_REGISTERED_USERS`, and `EVACUATION_HAVENS` from `frontend/app.js` and `frontend/evacuation-routes.js`.
4. **Read-Only Verification (`database/verify_database.sql`)**:
   - Verifies all 38 tables, 51 `ON DELETE RESTRICT` foreign keys, 27 triggers, 3 canonical RBAC roles, and confirms **0 rows** across all 37 non-role tables on a fresh installation.
