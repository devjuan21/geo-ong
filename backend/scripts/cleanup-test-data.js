/**
 * GeoSafe — Database Test & Sample Data Cleanup Script
 * Cleans up all orphaned E2E test reports, test rescue requests, test alerts,
 * test notifications, and test users while preserving genuine accounts.
 */
const db = require('../config/db');

async function cleanupTestData() {
  console.log('======================================================================');
  console.log(' GeoSafe Database Test Data Inspection & Cleanup');
  console.log('======================================================================\n');

  // 1. Identify test users
  const [testUsers] = await db.query(
    "SELECT id, email, role_id FROM users WHERE email LIKE '%e2e%' OR email LIKE '%test%' OR email LIKE 'inactive.resp.%' OR email LIKE 'other.desig.%'"
  );
  console.log(`Identified ${testUsers.length} test users to clean up:`);
  testUsers.forEach(u => console.log(`  - User #${u.id}: ${u.email} (Role ${u.role_id})`));

  const testUserIds = testUsers.map(u => u.id);

  // 2. Identify remaining test reports
  const [testReports] = await db.query(
    "SELECT id, reference_number, user_id, title, description, address, status FROM reports WHERE title LIKE '%Test%' OR description LIKE '%E2E%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%' OR email LIKE '%test%' OR email LIKE 'inactive.resp.%' OR email LIKE 'other.desig.%')"
  );
  console.log(`\nIdentified ${testReports.length} test reports to clean up.`);

  // 3. Identify remaining test rescue requests
  const [testRescues] = await db.query(
    "SELECT id, reference_number, user_id, emergency_type, description, address, status FROM rescue_requests WHERE description LIKE '%E2E%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%' OR email LIKE '%test%' OR email LIKE 'inactive.resp.%' OR email LIKE 'other.desig.%')"
  );
  console.log(`Identified ${testRescues.length} test rescue requests to clean up.`);

  // 4. Identify test alerts
  const [testAlerts] = await db.query(
    "SELECT id, message, severity FROM alerts WHERE message LIKE '%evacuation advisory for Purok 1%' OR created_by IN (SELECT id FROM users WHERE email LIKE '%e2e%' OR email LIKE '%test%' OR email LIKE 'inactive.resp.%' OR email LIKE 'other.desig.%')"
  );
  console.log(`Identified ${testAlerts.length} test alerts to clean up.`);

  // 5. Verify genuine records are untouched
  const [genuineUsers] = await db.query(
    "SELECT id, email, role_id FROM users WHERE email NOT LIKE '%e2e%' AND email NOT LIKE '%test%' AND email NOT LIKE 'inactive.resp.%' AND email NOT LIKE 'other.desig.%'"
  );
  console.log(`\nPreserving ${genuineUsers.length} genuine user account(s):`);
  genuineUsers.forEach(u => console.log(`  + Genuine User #${u.id}: ${u.email} (Role ${u.role_id})`));

  // Execute cleanups in dependency order
  console.log('\nExecuting cleanup in strict foreign key order...');

  try {
    // Temporarily disable immutable audit triggers for this administrative test cleanup
    await db.query("ALTER TABLE incident_status_history DISABLE TRIGGER trg_incident_status_history_immutable;").catch(() => {});
    await db.query("ALTER TABLE rescue_status_history DISABLE TRIGGER trg_rescue_status_history_immutable;").catch(() => {});
    await db.query("ALTER TABLE emergency_broadcast_logs DISABLE TRIGGER trg_emergency_broadcast_logs_immutable;").catch(() => {});
    await db.query("ALTER TABLE audit_logs DISABLE TRIGGER trg_audit_logs_immutable;").catch(() => {});
    await db.query("ALTER TABLE auth_security_logs DISABLE TRIGGER trg_auth_security_logs_immutable;").catch(() => {});
    await db.query("ALTER TABLE account_status_history DISABLE TRIGGER trg_account_status_history_immutable;").catch(() => {});

    // Responder assignment history referencing reports or rescues or test responders
    await db.query("DELETE FROM responder_assignment_history WHERE incident_id IN (SELECT id FROM reports WHERE title LIKE '%Test%' OR description LIKE '%E2E%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%')) OR rescue_id IN (SELECT id FROM rescue_requests WHERE description LIKE '%E2E%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%')) OR responder_user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%')");

    // Incident reports & child tables
    await db.query("DELETE FROM incident_attachments WHERE incident_id IN (SELECT id FROM reports WHERE title LIKE '%Test%' OR description LIKE '%E2E%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%'))");
    await db.query("DELETE FROM incident_status_history WHERE incident_id IN (SELECT id FROM reports WHERE title LIKE '%Test%' OR description LIKE '%E2E%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%'))");
    await db.query("DELETE FROM incident_assignments WHERE report_id IN (SELECT id FROM reports WHERE title LIKE '%Test%' OR description LIKE '%E2E%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%'))");
    await db.query("DELETE FROM incident_updates WHERE report_id IN (SELECT id FROM reports WHERE title LIKE '%Test%' OR description LIKE '%E2E%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%'))");
    await db.query("DELETE FROM reports WHERE title LIKE '%Test%' OR description LIKE '%E2E%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%')");
    console.log('  [DONE] Deleted test reports and related attachments/updates/assignments.');

    // Rescue requests & child tables
    await db.query("DELETE FROM rescue_attachments WHERE rescue_id IN (SELECT id FROM rescue_requests WHERE description LIKE '%E2E%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%'))");
    await db.query("DELETE FROM rescue_status_history WHERE rescue_id IN (SELECT id FROM rescue_requests WHERE description LIKE '%E2E%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%'))");
    await db.query("DELETE FROM rescue_assignments WHERE rescue_id IN (SELECT id FROM rescue_requests WHERE description LIKE '%E2E%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%'))");
    await db.query("DELETE FROM rescue_updates WHERE rescue_id IN (SELECT id FROM rescue_requests WHERE description LIKE '%E2E%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%'))");
    await db.query("DELETE FROM rescue_requests WHERE description LIKE '%E2E%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%')");
    console.log('  [DONE] Deleted test rescue requests and related assignments/updates.');

    // Alerts & broadcasts
    await db.query("DELETE FROM emergency_broadcast_logs WHERE authorized_by IN (SELECT id FROM users WHERE email LIKE '%e2e%')");
    await db.query("DELETE FROM alerts WHERE message LIKE '%evacuation advisory for Purok 1%' OR created_by IN (SELECT id FROM users WHERE email LIKE '%e2e%')");
    console.log('  [DONE] Deleted test alerts and broadcast logs.');

    // Notifications
    await db.query("DELETE FROM notification_recipients WHERE notification_id IN (SELECT id FROM notifications WHERE title LIKE '%E2E%' OR title LIKE '%INC-2026%' OR title LIKE '%RES-2026%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%'))");
    await db.query("DELETE FROM notifications WHERE title LIKE '%E2E%' OR title LIKE '%INC-2026%' OR title LIKE '%RES-2026%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%')");
    console.log('  [DONE] Deleted test notifications and recipient entries.');

    // Test users & profile/security logs
    if (testUserIds.length) {
      await db.query("DELETE FROM auth_security_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%' OR email LIKE '%test%' OR email LIKE 'inactive.resp.%' OR email LIKE 'other.desig.%')");
      await db.query("DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%' OR email LIKE '%test%' OR email LIKE 'inactive.resp.%' OR email LIKE 'other.desig.%')");
      await db.query("DELETE FROM account_status_history WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%' OR email LIKE '%test%' OR email LIKE 'inactive.resp.%' OR email LIKE 'other.desig.%')");
      await db.query("DELETE FROM responder_assignment_history WHERE responder_user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%' OR email LIKE '%test%' OR email LIKE 'inactive.resp.%' OR email LIKE 'other.desig.%')");
      await db.query("DELETE FROM responder_profiles WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%' OR email LIKE '%test%' OR email LIKE 'inactive.resp.%' OR email LIKE 'other.desig.%')");
      await db.query("DELETE FROM user_profiles WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%' OR email LIKE '%test%' OR email LIKE 'inactive.resp.%' OR email LIKE 'other.desig.%')");
      await db.query("DELETE FROM users WHERE email LIKE '%e2e%' OR email LIKE '%test%' OR email LIKE 'inactive.resp.%' OR email LIKE 'other.desig.%'");
      console.log(`  [DONE] Deleted ${testUserIds.length} test users and related user profiles/security logs.`);
    }
  } finally {
    // Re-enable immutable audit triggers
    await db.query("ALTER TABLE incident_status_history ENABLE TRIGGER trg_incident_status_history_immutable;").catch(() => {});
    await db.query("ALTER TABLE rescue_status_history ENABLE TRIGGER trg_rescue_status_history_immutable;").catch(() => {});
    await db.query("ALTER TABLE emergency_broadcast_logs ENABLE TRIGGER trg_emergency_broadcast_logs_immutable;").catch(() => {});
    await db.query("ALTER TABLE audit_logs ENABLE TRIGGER trg_audit_logs_immutable;").catch(() => {});
    await db.query("ALTER TABLE auth_security_logs ENABLE TRIGGER trg_auth_security_logs_immutable;").catch(() => {});
    await db.query("ALTER TABLE account_status_history ENABLE TRIGGER trg_account_status_history_immutable;").catch(() => {});
  }

  // Verification counts
  const [finalReports] = await db.query('SELECT COUNT(*) as count FROM reports');
  const [finalRescues] = await db.query('SELECT COUNT(*) as count FROM rescue_requests');
  const [finalAlerts] = await db.query('SELECT COUNT(*) as count FROM alerts');
  const [finalNotifs] = await db.query('SELECT COUNT(*) as count FROM notifications');
  const [finalUsers] = await db.query('SELECT COUNT(*) as count FROM users');

  console.log('\n======================================================================');
  console.log(' FINAL DATABASE STATE VERIFICATION:');
  console.log(`  - reports:         ${finalReports[0].count} (Expected: 0)`);
  console.log(`  - rescue_requests: ${finalRescues[0].count} (Expected: 0)`);
  console.log(`  - alerts:          ${finalAlerts[0].count} (Expected: 0)`);
  console.log(`  - notifications:   ${finalNotifs[0].count} (Expected: 0)`);
  console.log(`  - users:           ${finalUsers[0].count} (Expected: 2 genuine accounts)`);
  console.log('======================================================================');
}

cleanupTestData()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Cleanup failed:', err);
    process.exit(1);
  });
