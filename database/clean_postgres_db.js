/**
 * GeoSafe — PostgreSQL Clean Start Cleanup Script (Prepared for Review)
 *
 * Removes all test/demo operational records, non-admin accounts, and archived
 * placeholder users from PostgreSQL `geosafe_db` while preserving:
 *   - All 32 tables, indexes, constraints, and triggers
 *   - Canonical RBAC roles (Administrator, Responder, Resident)
 *   - Official Barangay Bayanan geography & category seed data
 *     (incident_categories, evacuation_centers, evacuation_center_facilities,
 *      evacuation_routes, evacuation_route_waypoints, hospitals)
 *
 * Usage (ONLY after explicit approval):
 *   node database/clean_postgres_db.js --confirm
 */
const path = require('path');
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({
  path: path.join(__dirname, '../backend/.env'),
});
const { Client } = require(path.join(__dirname, '../backend/node_modules/pg'));

const IMMUTABLE_TRIGGER_TABLES = new Set([
  'emergency_broadcast_logs',
  'rescue_status_history',
  'incident_status_history',
  'account_status_history',
  'audit_logs',
  'auth_security_logs',
]);

const DELETE_OPERATIONAL_ORDER = [
  'notification_recipients',
  'notifications',
  'emergency_broadcast_logs',
  'alerts',
  'rescue_updates',
  'rescue_status_history',
  'rescue_assignments',
  'rescue_attachments',
  'rescue_requests',
  'incident_updates',
  'incident_status_history',
  'incident_assignments',
  'incident_attachments',
  'reports',
  'responder_assignment_history',
  'responder_profiles',
  'account_status_history',
  'user_profiles',
  'audit_logs',
  'auth_security_logs',
];

async function cleanPostgres() {
  if (!process.argv.includes('--confirm')) {
    console.error('Refusing to run without --confirm flag. Review the script before executing.');
    process.exit(1);
  }

  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'geosafe_db',
  });

  await client.connect();

  try {
    await client.query('BEGIN');

    // 1. Delete operational & pre-cutover log tables in child-to-parent FK order
    for (const table of DELETE_OPERATIONAL_ORDER) {
      const hasImmutableTrigger = IMMUTABLE_TRIGGER_TABLES.has(table);
      if (hasImmutableTrigger) {
        await client.query(`ALTER TABLE "${table}" DISABLE TRIGGER USER`);
      }
      const res = await client.query(`DELETE FROM "${table}"`);
      if (hasImmutableTrigger) {
        await client.query(`ALTER TABLE "${table}" ENABLE TRIGGER USER`);
      }
      console.log(`Cleared ${table}: ${res.rowCount} row(s) removed`);
    }

    // 3. Remove all non-admin and archived placeholder users (and old non-canonical admin accounts)
    const userDelRes = await client.query(
      `DELETE FROM users WHERE LOWER(email) <> LOWER($1)`,
      ['admin@geosafe.ph']
    );
    console.log(`Removed non-target user accounts: ${userDelRes.rowCount} row(s) removed`);

    // 4. Reset role_sequences
    await client.query(`UPDATE role_sequences SET next_val = 1`);

    // 5. Reset serial sequences for cleared tables
    const seqRes = await client.query(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND column_default LIKE '%nextval(%'
       ORDER BY table_name`
    );
    for (const { table_name, column_name } of seqRes.rows) {
      await client.query(
        `SELECT setval(
           pg_get_serial_sequence($1, $2),
           GREATEST(COALESCE((SELECT MAX("${column_name}") FROM "${table_name}"), 1), 1),
           (SELECT MAX("${column_name}") IS NOT NULL FROM "${table_name}")
         )`,
        [table_name, column_name]
      );
    }

    await client.query('COMMIT');
    console.log('PostgreSQL clean-start cleanup committed successfully.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

cleanPostgres().catch((err) => {
  console.error('Cleanup failed:', err.message);
  process.exit(1);
});

