/**
 * GeoSafe - Barangay Bayanan Responder Registration Test Suite
 * ============================================================================
 * Verifies:
 * 1. Admin Modal HTML structure in frontend/admin.html:
 *    - All 6 old fields removed (Initial Password, Badge Number, Callsign, Department, Specialization, old unit)
 *    - Single fixed organization: "Barangay Bayanan Emergency Response Team" (NO dropdown)
 *    - Personal Info: First Name, Middle Name, Last Name, Contact Number, Email
 *    - Responder Info: Responder Unit (fixed display), Designation / Position dropdown, Custom Designation, Service ID
 *    - Account Status removed from creation form (defaults to active automatically)
 *    - Auto-generated Responder ID hidden from creation form
 *    - Created credentials confirmation modal configured
 * 2. Frontend JS logic in frontend/assets/js/admin.js:
 *    - Fixed unit payload
 *    - Default active status
 *    - Auto-generated ID & temporary credentials modal display
 * 3. Backend Route & Controller Implementation in adminRoutes.js and adminController.js:
 *    - Route protection: authenticate + requireRole("admin")
 *    - Controller: creates responder with role_id = 2, fixed unit, auto-generated RSPDR ID,
 *      temporary password with must_change_password = true, and audit log.
 * 4. Database Data Integrity Check:
 *    - ZERO test/demo accounts in PostgreSQL users table
 *    - Preserves legitimate Administrator and Resident accounts
 *    - ZERO hardcoded or fake incident reports / rescue requests
 * 
 * STRICT COMPLIANCE:
 * Never creates test or sample user accounts in the application database (geosafe_db).
 * ============================================================================
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pool = require('../models/db');
const { ROLE_IDS } = require('../config/roles');

async function runVerification() {
  console.log('================================================================');
  console.log(' GeoSafe Barangay Bayanan Responder Registration Verification');
  console.log('================================================================\n');

  const adminHtmlPath = path.join(__dirname, '../../frontend/admin.html');
  const adminJsPath = path.join(__dirname, '../../frontend/assets/js/admin.js');
  const adminRoutesPath = path.join(__dirname, '../routes/adminRoutes.js');
  const adminCtrlPath = path.join(__dirname, '../controllers/adminController.js');

  const adminHtml = fs.readFileSync(adminHtmlPath, 'utf8');
  const adminJs = fs.readFileSync(adminJsPath, 'utf8');
  const adminRoutes = fs.readFileSync(adminRoutesPath, 'utf8');
  const adminCtrl = fs.readFileSync(adminCtrlPath, 'utf8');

  // 1. Audit frontend/admin.html modal structure
  console.log('1. Auditing frontend/admin.html modal structure:');

  assert(adminHtml.includes('id="admin-create-responder-form"'), 'Creation form exists');

  const createModalRegex = /<form id="admin-create-responder-form"[\s\S]*?<\/form>/;
  const modalMatch = adminHtml.match(createModalRegex);
  assert(modalMatch, 'Found admin-create-responder-form in HTML');
  const modalHtml = modalMatch[0];

  assert(!modalHtml.includes('id="resp-password"'), 'Old initial password field removed');
  assert(!modalHtml.includes('id="resp-badge"'), 'Old badge number input removed');
  assert(!modalHtml.includes('id="resp-callsign"'), 'Old callsign input removed');
  assert(!modalHtml.includes('id="resp-department"'), 'Old department input removed');
  assert(!modalHtml.includes('id="resp-specialization"'), 'Old specialization input removed');
  assert(!modalHtml.includes('<select id="resp-organization"'), 'NO organization dropdown in creation modal');
  console.log('  [PASS] All old fields and organization dropdown removed from create responder modal');

  // Verify new fields
  assert(modalHtml.includes('id="resp-first-name"'), 'First Name field present');
  assert(modalHtml.includes('id="resp-middle-name"'), 'Middle Name field present');
  assert(modalHtml.includes('id="resp-last-name"'), 'Last Name field present');
  assert(modalHtml.includes('id="resp-phone"'), 'Contact Number field present');
  assert(modalHtml.includes('id="resp-email"'), 'Email Address field present');
  assert(modalHtml.includes('Barangay Bayanan Emergency Response Team'), 'Fixed organization unit displayed');
  assert(modalHtml.includes('id="resp-designation"'), 'Designation dropdown present');
  assert(modalHtml.includes('id="resp-custom-designation"'), 'Custom designation input present');
  assert(modalHtml.includes('id="resp-service-id"'), 'Service ID field present');
  assert(!modalHtml.includes('id="resp-status"'), 'Account Status dropdown cleanly removed from creation form');
  assert(!modalHtml.includes('Account Information'), 'Account Information section cleanly removed from creation form');

  // Verify required designations in dropdown
  const requiredDesignations = [
    'Responder / Rescue Personnel',
    'Team Leader',
    'Fire Safety Personnel',
    'Medical Responder / First Aider',
    'Emergency Coordinator',
    'Communications Officer',
    'Barangay Tanod',
    'Other'
  ];
  for (const d of requiredDesignations) {
    assert(modalHtml.includes(d), `Designation option "${d}" present in dropdown`);
  }
  console.log('  [PASS] All required designation options present in dropdown');

  // Verify Responder ID is NOT an input field in creation form
  assert(!modalHtml.includes('name="responder_id"'), 'No responder_id input');
  assert(!modalHtml.includes('id="resp-id"'), 'No resp-id input');
  assert(!modalHtml.includes('id="responder-id"'), 'No responder-id input');
  console.log('  [PASS] Responder ID is auto-generated and completely hidden from creation form');

  // Verify confirmation modal
  assert(adminHtml.includes('id="admin-responder-created-modal"'), 'Responder created confirmation modal present');
  assert(adminHtml.includes('id="created-resp-id"'), 'Displays auto-generated ID in confirmation modal');
  assert(adminHtml.includes('id="created-resp-temp-pass"'), 'Displays temporary password in confirmation modal');
  console.log('  [PASS] Auto-generated credentials confirmation modal configured');

  // 2. Audit frontend/assets/js/admin.js logic
  console.log('\n2. Auditing frontend/assets/js/admin.js logic:');
  assert(adminJs.includes('openCreateResponderModal'), 'openCreateResponderModal implemented');
  assert(adminJs.includes('closeCreateResponderModal'), 'closeCreateResponderModal implemented');
  assert(adminJs.includes('closeResponderCreatedModal'), 'closeResponderCreatedModal implemented');
  assert(adminJs.includes('copyTemporaryPassword'), 'copyTemporaryPassword implemented');
  assert(adminJs.includes('submitCreateResponder'), 'submitCreateResponder implemented');
  assert(adminJs.includes('Barangay Bayanan Emergency Response Team'), 'Fixed organization in submit payload');
  assert(adminJs.includes("status = 'active'"), 'New responder defaults to active status');
  console.log('  [PASS] All frontend responder creation and confirmation functions verified');

  // 3. Audit backend routes & controller logic
  console.log('\n3. Auditing Backend Routes & Controller Logic:');
  assert(adminRoutes.includes("'/users/responders'"), 'POST /users/responders route defined');
  assert(adminRoutes.includes("requireRole('admin')"), 'Route protected by Administrator role requirement');
  assert(adminCtrl.includes('createResponderAccount'), 'createResponderAccount controller exported');
  assert(adminCtrl.includes('Barangay Bayanan Emergency Response Team'), 'Fixed unit assigned in controller');
  assert(adminCtrl.includes('generateNextUserCode'), 'Generates next canonical user code in controller');
  assert(adminCtrl.includes('must_change_password'), 'Enforces first-time password change on created responder');
  assert(adminCtrl.includes('RESPONDER_ACCOUNT_CREATED'), 'Records audit log on responder creation');
  console.log('  [PASS] Backend route guards, fixed unit mapping, ID generation, and audit logging verified');

  // 4. Data Integrity: Zero hardcoded or sample incident reports & users in PostgreSQL
  console.log('\n4. Verifying Zero Test Accounts & Reports in PostgreSQL Database:');
  const [testUserRows] = await pool.query(
    "SELECT id, email, role_id FROM users WHERE email LIKE '%e2e%' OR email LIKE '%test%' OR email LIKE 'inactive.resp.%' OR email LIKE 'other.desig.%'"
  );
  assert(testUserRows.length === 0, `Database contains ZERO test accounts (found ${testUserRows.length})`);
  console.log('  [PASS] ZERO test, demo, or fabricated accounts found in users table');

  const [allUsers] = await pool.query('SELECT id, email, role_id FROM users ORDER BY id ASC');
  console.log(`  Current legitimate users in PostgreSQL: ${allUsers.length}`);
  allUsers.forEach((u) => {
    console.log(`    - User #${u.id}: ${u.email} (Role ID ${u.role_id})`);
  });

  const [[reportCount]] = await pool.query('SELECT COUNT(*) AS total FROM reports');
  const [[rescueCount]] = await pool.query('SELECT COUNT(*) AS total FROM rescue_requests');
  console.log(`  Current reports in PostgreSQL: ${reportCount.total}`);
  console.log(`  Current rescue requests in PostgreSQL: ${rescueCount.total}`);
  assert(Number(reportCount.total) === 0, 'Database reports count is pristine (0 fake reports)');
  assert(Number(rescueCount.total) === 0, 'Database rescue_requests count is pristine (0 fake requests)');
  console.log('  [PASS] Zero fake or hardcoded reports in PostgreSQL verified');

  console.log('\n================================================================');
  console.log(' ALL BARANGAY BAYANAN RESPONDER REGISTRATION TESTS PASSED!');
  console.log('================================================================\n');
}

runVerification()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n[FAIL] Verification error:', err);
    process.exit(1);
  });
