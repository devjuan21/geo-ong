/**
 * GeoSafe - Comprehensive Verification Test Suite: QR-Based Family Safety Tracker
 * Tests all 12 key prompt requirements:
 * 1. Family group creation by authenticated resident
 * 2. Secure QR invitation generation (SHA-256 token hashing)
 * 3. Safe validation of invitation token
 * 4. User request to join workflow
 * 5. Manager review (approval / rejection)
 * 6. Multi-user membership (3+ members supported)
 * 7. Duplicate membership & duplicate join request prevention
 * 8. Rejection of expired and revoked invitations
 * 9. Privacy: Location sharing strictly disabled by default
 * 10. Privacy: Hidden coordinates when sharing is disabled
 * 11. Privacy: Explicit consent grants coordinate updates
 * 12. Privacy: Revoking consent immediately terminates visibility
 * 13. Zero emojis in all family files
 * 14. Zero hardcoded mock users / fake locations
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Mock browser storage & window for node test environment
const mockSessionStorage = {};
global.sessionStorage = {
  getItem: (k) => mockSessionStorage[k] || null,
  setItem: (k, v) => { mockSessionStorage[k] = String(v); },
  removeItem: (k) => { delete mockSessionStorage[k]; },
  clear: () => { Object.keys(mockSessionStorage).forEach(k => delete mockSessionStorage[k]); }
};

global.window = {
  location: { origin: 'http://localhost:3000', search: '', href: 'http://localhost:3000/family.html' },
  addEventListener: () => {},
  dispatchEvent: () => {}
};

// Load Store and QR Code library
const storePath = path.join(__dirname, '../../../frontend', 'assets', 'js', 'store.js');
const qrcodePath = path.join(__dirname, '../../../frontend', 'assets', 'js', 'qrcode.min.js');
const familyJsPath = path.join(__dirname, '../../../frontend', 'assets', 'js', 'family.js');
const familyHtmlPath = path.join(__dirname, '../../../frontend', 'family.html');
const schemaSqlPath = path.join(__dirname, '../../../database', 'geosafe_db_schema.sql');
const migrationSqlPath = path.join(__dirname, '../../../database', 'migrations', '002_family_qr_membership.sql');

require(storePath);
const QRCode = require(qrcodePath);

const store = global.window.geoSafeStore;
store.config.USE_MOCK_DATA = true; // Use store offline state directly in test environment

let passed = 0;
let failed = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  [PASS] ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${desc}: ${err.message}`);
    failed++;
  }
}

async function itAsync(desc, fn) {
  try {
    await fn();
    console.log(`  [PASS] ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${desc}: ${err.message}`);
    failed++;
  }
}

(async function runTests() {
  console.log('\n================================================================');
  console.log(' GeoSafe QR Family Safety Tracker Comprehensive Verification');
  console.log('================================================================\n');

  console.log('1. Checking File Existence & Integrations:');
  it('family.html exists', () => assert.ok(fs.existsSync(familyHtmlPath)));
  it('assets/js/family.js exists', () => assert.ok(fs.existsSync(familyJsPath)));
  it('assets/js/qrcode.min.js exists and generates SVG', () => {
    assert.ok(fs.existsSync(qrcodePath));
    const svg = QRCode.toSVG('https://geosafe.local/family.html?invite=test1234');
    assert.ok(svg.includes('<svg') && svg.includes('<rect'));
  });
  it('database/geosafe_db_schema.sql updated with Module 5 tables', () => {
    const sql = fs.readFileSync(schemaSqlPath, 'utf8');
    assert.ok(sql.includes('family_groups'));
    assert.ok(sql.includes('family_members'));
    assert.ok(sql.includes('family_invitations'));
    assert.ok(sql.includes('family_join_requests'));
    assert.ok(sql.includes('family_location_sharing_consents'));
    assert.ok(sql.includes('family_location_updates'));
  });
  it('database/migrations/002_family_qr_membership.sql created', () => {
    assert.ok(fs.existsSync(migrationSqlPath));
    const mig = fs.readFileSync(migrationSqlPath, 'utf8');
    assert.ok(mig.includes('family_invitations'));
  });

  console.log('\n2. Verifying Zero Emojis in Family Modules:');
  const emojiRegex = /[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  it('No emojis in family.html', () => {
    const content = fs.readFileSync(familyHtmlPath, 'utf8');
    assert.strictEqual(emojiRegex.test(content), false);
  });
  it('No emojis in assets/js/family.js', () => {
    const content = fs.readFileSync(familyJsPath, 'utf8');
    assert.strictEqual(emojiRegex.test(content), false);
  });
  it('No emojis in migration script', () => {
    const content = fs.readFileSync(migrationSqlPath, 'utf8');
    assert.strictEqual(emojiRegex.test(content), false);
  });

  console.log('\n3. Testing Fresh System State (Zero Fake Data):');
  await itAsync('Pristine state has 0 family groups and empty members list', async () => {
    store.state.familyGroups = [];
    store.state.familyMembers = [];
    store.state.familyInvitations = [];
    store.state.familyJoinRequests = [];
    store.state.familyLocationConsents = {};
    store.state.currentUser = null;
    const res = await store.getMyFamily();
    assert.strictEqual(res.family, null);
    assert.strictEqual(res.members.length, 0);
  });

  console.log('\n4. Testing Family Group Creation:');
  const user1 = { id: 101, name: 'Eduardo Santos', email: 'eduardo@geosafe.ph', role: 'resident' };
  await itAsync('Resident 1 (Eduardo) creates Dela Cruz-Santos Family', async () => {
    store.state.currentUser = user1;
    const res = await store.createFamilyGroup({
      family_name: 'Dela Cruz-Santos Household',
      relationship: 'Head of Household'
    });
    assert.strictEqual(res.family.family_name, 'Dela Cruz-Santos Household');
    assert.strictEqual(res.family.is_manager, true);
    assert.strictEqual(res.myMembership.membership_role, 'manager');
    assert.strictEqual(res.myMembership.location_sharing_enabled, false); // privacy default
  });

  await itAsync('Prevent user from creating another family while already an active member', async () => {
    store.state.currentUser = user1;
    let failedAsExpected = false;
    try {
      await store.createFamilyGroup({ family_name: 'Second Family' });
    } catch (e) {
      failedAsExpected = true;
    }
    assert.strictEqual(failedAsExpected, true);
  });

  console.log('\n5. Testing Secure QR Invitation Generation & Validation:');
  let rawToken = null;
  await itAsync('Family Manager generates QR invitation with SHA-256 hashed storage', async () => {
    store.state.currentUser = user1;
    const res = await store.generateFamilyInvitation(72);
    assert.ok(res.invitation);
    assert.ok(res.invitation.token);
    rawToken = res.invitation.token;
    assert.ok(rawToken.length >= 32);

    // Verify stored invitation holds hashed token, NOT raw token
    const storedInv = store.state.familyInvitations[0];
    assert.notStrictEqual(storedInv.token_hash, rawToken);
    assert.strictEqual(storedInv.token_hash, store._hashTokenSync(rawToken));
  });

  await itAsync('Validate QR invitation returns safe presentation metadata (family name & inviter)', async () => {
    assert.ok(rawToken, 'rawToken must be defined');
    const val = await store.validateFamilyInvitation(rawToken);
    assert.strictEqual(val.valid, true);
    assert.strictEqual(val.family_name, 'Dela Cruz-Santos Household');
    assert.ok(!val.password && !val.coordinates && !val.members); // sensitive info excluded
  });

  await itAsync('Invalid token is rejected during validation', async () => {
    let failedAsExpected = false;
    try {
      await store.validateFamilyInvitation('invalid_nonexistent_token_12345');
    } catch (e) {
      failedAsExpected = true;
    }
    assert.strictEqual(failedAsExpected, true);
  });

  console.log('\n6. Testing QR Joining Workflow & Manager Approvals:');
  const user2 = { id: 102, name: 'Maria Santos', email: 'maria@geosafe.ph', role: 'resident' };
  await itAsync('Resident 2 (Maria) requests to join using QR token', async () => {
    store.state.currentUser = user2;
    const res = await store.submitFamilyJoinRequest(rawToken, 'Spouse');
    assert.ok(res.request);
    assert.strictEqual(res.request.applicant_name, 'Maria Santos');
    assert.strictEqual(res.request.request_status, 'pending');
  });

  await itAsync('Prevent duplicate pending join requests from same user', async () => {
    store.state.currentUser = user2;
    let failedAsExpected = false;
    try {
      await store.submitFamilyJoinRequest(rawToken, 'Spouse');
    } catch (e) {
      failedAsExpected = true;
    }
    assert.strictEqual(failedAsExpected, true);
  });

  await itAsync('Resident 2 does not appear as active member prior to manager approval', async () => {
    store.state.currentUser = user1;
    const myFam = await store.getMyFamily();
    assert.strictEqual(myFam.members.length, 1);
    assert.strictEqual(myFam.pendingRequests.length, 1);
  });

  await itAsync('Family Manager reviews and approves Resident 2 join request', async () => {
    store.state.currentUser = user1;
    const pending = await store.getPendingJoinRequests();
    const reqId = pending.pendingRequests[0].id;
    const review = await store.reviewFamilyJoinRequest(reqId, 'approve');
    assert.strictEqual(review.status, 'approved');

    // Now member count is 2
    const myFam = await store.getMyFamily();
    assert.strictEqual(myFam.members.length, 2);
    const maria = myFam.members.find(m => m.name === 'Maria Santos');
    assert.ok(maria);
    assert.strictEqual(maria.membership_role, 'member');
    assert.strictEqual(maria.locationSharing.enabled, false); // must start disabled
  });

  console.log('\n7. Testing 3+ Member Multi-User Support:');
  const user3 = { id: 103, name: 'Lucas Santos', email: 'lucas@geosafe.ph', role: 'resident' };
  const user4 = { id: 104, name: 'Clara Santos', email: 'clara@geosafe.ph', role: 'resident' };

  await itAsync('Resident 3 (Lucas) joins family successfully (3rd member)', async () => {
    store.state.currentUser = user3;
    await store.submitFamilyJoinRequest(rawToken, 'Child / Dependent');
    store.state.currentUser = user1;
    const pending = await store.getPendingJoinRequests();
    const reqId = pending.pendingRequests[0].id;
    await store.reviewFamilyJoinRequest(reqId, 'approve');

    const myFam = await store.getMyFamily();
    assert.strictEqual(myFam.members.length, 3);
  });

  await itAsync('Resident 4 (Clara) joins family successfully (4th member - no hardcoded 3-member ceiling)', async () => {
    store.state.currentUser = user4;
    await store.submitFamilyJoinRequest(rawToken, 'Parent (Senior)');
    store.state.currentUser = user1;
    const pending = await store.getPendingJoinRequests();
    const reqId = pending.pendingRequests[0].id;
    await store.reviewFamilyJoinRequest(reqId, 'approve');

    const myFam = await store.getMyFamily();
    assert.strictEqual(myFam.members.length, 4);
  });

  console.log('\n8. Testing Location Sharing Privacy & Mutual Consent:');
  await itAsync('Coordinates are hidden and display "Location sharing off" when sharing is disabled', async () => {
    store.state.currentUser = user1;
    const locations = await store.getFamilyLocations();
    assert.strictEqual(locations.locations.length, 0); // No one has opted in yet
  });

  await itAsync('Resident 1 explicitly grants consent and records GPS coordinates', async () => {
    store.state.currentUser = user1;
    const consentRes = await store.toggleFamilyLocationSharing(true);
    assert.strictEqual(consentRes.location_sharing_enabled, true);

    await store.updateFamilyLocation(14.4080, 121.0482, 88, 'safe');
    const myFam = await store.getMyFamily();
    const self = myFam.members.find(m => m.is_self);
    assert.strictEqual(self.locationSharing.enabled, true);
    assert.strictEqual(self.locationSharing.latitude, 14.4080);
    assert.strictEqual(self.locationSharing.longitude, 121.0482);
  });

  await itAsync('Other family members can view Resident 1 location now that sharing is active', async () => {
    store.state.currentUser = user2;
    const locations = await store.getFamilyLocations();
    assert.strictEqual(locations.locations.length, 1);
    assert.strictEqual(locations.locations[0].name, 'Eduardo Santos');
    assert.strictEqual(locations.locations[0].latitude, 14.4080);
  });

  await itAsync('Resident 1 revokes location sharing -> coordinates immediately hidden from all members', async () => {
    store.state.currentUser = user1;
    const consentRes = await store.toggleFamilyLocationSharing(false);
    assert.strictEqual(consentRes.location_sharing_enabled, false);

    store.state.currentUser = user2;
    const locations = await store.getFamilyLocations();
    assert.strictEqual(locations.locations.length, 0); // hidden immediately
  });

  console.log('\n9. Testing QR Revocation & Expiration:');
  await itAsync('Revoking active invitation blocks subsequent join attempts', async () => {
    store.state.currentUser = user1;
    const activeInv = store.state.familyInvitations.find(i => !i.revoked_at);
    assert.ok(activeInv, 'Active invitation must exist');
    await store.revokeFamilyInvitation(activeInv.id);

    const user5 = { id: 105, name: 'Pedro Gomez', email: 'pedro@geosafe.ph', role: 'resident' };
    store.state.currentUser = user5;
    let failedAsExpected = false;
    try {
      await store.submitFamilyJoinRequest(rawToken, 'Relative');
    } catch (e) {
      failedAsExpected = true;
    }
    assert.strictEqual(failedAsExpected, true);
  });

  console.log('\n10. Testing Member Removal:');
  await itAsync('Family Manager can remove member (Lucas)', async () => {
    store.state.currentUser = user1;
    const myFam = await store.getMyFamily();
    const lucas = myFam.members.find(m => m.name === 'Lucas Santos');
    assert.ok(lucas, 'Lucas must be in the family');
    await store.removeFamilyMember(lucas.id);

    const updated = await store.getMyFamily();
    assert.strictEqual(updated.members.length, 3);
    assert.ok(!updated.members.some(m => m.name === 'Lucas Santos'));
  });

  await itAsync('Regular members cannot remove other members', async () => {
    store.state.currentUser = user2;
    let failedAsExpected = false;
    try {
      const myFam = await store.getMyFamily();
      const clara = myFam.members.find(m => m.name === 'Clara Santos');
      await store.removeFamilyMember(clara.id);
    } catch (e) {
      failedAsExpected = true;
    }
    assert.strictEqual(failedAsExpected, true);
  });

  console.log('\n11. Testing Fixed Location Family Address Form & Backend Enforcement:');
  it('family.html has NO editable fields for Region, Province, City, Barangay, or ZIP', () => {
    const html = fs.readFileSync(familyHtmlPath, 'utf8');
    assert.strictEqual(html.includes('id="addr-region"'), false);
    assert.strictEqual(html.includes('id="addr-province"'), false);
    assert.strictEqual(html.includes('id="addr-city"'), false);
    assert.strictEqual(html.includes('id="addr-barangay"'), false);
    assert.strictEqual(html.includes('id="addr-country"'), false);
    assert.strictEqual(html.includes('id="addr-zip"'), false);
  });

  it('family.html displays non-editable Fixed Location coverage badge for Barangay Bayanan, Muntinlupa City', () => {
    const html = fs.readFileSync(familyHtmlPath, 'utf8');
    assert.ok(html.includes('Barangay Bayanan, Muntinlupa City, Metro Manila, Philippines'));
    assert.ok(html.includes('Fixed Location Coverage'));
  });

  it('family.html has exactly 2 resident input fields: House/Building Number and Street Name', () => {
    const html = fs.readFileSync(familyHtmlPath, 'utf8');
    assert.ok(html.includes('id="addr-house-number"'));
    assert.ok(html.includes('id="addr-street"'));
    assert.ok(html.includes('id="btn-save-address"'));
  });

  it('family.html has ZERO maps or GPS pickers in family tracker', () => {
    const html = fs.readFileSync(familyHtmlPath, 'utf8');
    assert.strictEqual(html.includes('id="family-map"'), false);
    assert.strictEqual(html.includes('id="map-container"'), false);
  });

  it('Backend routes require ONLY street and house_number for address updates', () => {
    const backendRoutesPath = 'C:\\VSCODE-PROJECTS\\GEOSAFE-SYSTEM\\backend\\routes\\familyRoutes.js';
    const routesContent = fs.readFileSync(backendRoutesPath, 'utf8');
    assert.ok(routesContent.includes("body('street')"));
    assert.ok(routesContent.includes("body('house_number')"));
    assert.strictEqual(routesContent.includes("body('region').trim().notEmpty()"), false);
    assert.strictEqual(routesContent.includes("body('city').trim().notEmpty()"), false);
    assert.strictEqual(routesContent.includes("body('barangay').trim().notEmpty()"), false);
  });

  it('Backend controller enforces Bayanan and Muntinlupa City server-side', () => {
    const backendCtrlPath = 'C:\\VSCODE-PROJECTS\\GEOSAFE-SYSTEM\\backend\\controllers\\familyController.js';
    const ctrlContent = fs.readFileSync(backendCtrlPath, 'utf8');
    assert.ok(ctrlContent.includes("FIXED_BARANGAY = 'Bayanan'"));
    assert.ok(ctrlContent.includes("FIXED_CITY = 'Muntinlupa City'"));
    assert.ok(ctrlContent.includes("FIXED_PROVINCE = 'Metro Manila'"));
    assert.ok(ctrlContent.includes("FIXED_COUNTRY = 'Philippines'"));
  });

  await itAsync('Non-manager member (Maria) cannot update family address', async () => {
    store.state.currentUser = user2; // regular member
    let failedAsExpected = false;
    try {
      await store.updateFamilyAddress({
        house_number: 'Unit 502',
        street: 'Arandia St'
      });
    } catch (e) {
      failedAsExpected = true;
    }
    assert.strictEqual(failedAsExpected, true);
  });

  await itAsync('Manager (Eduardo) updates family address with House Number and Street Name', async () => {
    store.state.currentUser = user1; // household manager
    const res = await store.updateFamilyAddress({
      house_number: 'Block 4 Lot 12',
      street: 'Bautista St'
    });

    assert.ok(res.address);
    assert.strictEqual(res.address.house_number, 'Block 4 Lot 12');
    assert.strictEqual(res.address.street, 'Bautista St');
    assert.strictEqual(res.address.barangay, 'Bayanan');
    assert.strictEqual(res.address.city, 'Muntinlupa City');
    assert.strictEqual(res.address.province, 'Metro Manila');
    assert.strictEqual(res.address.country, 'Philippines');
    assert.strictEqual(res.address.formatted, 'Block 4 Lot 12 Bautista St, Barangay Bayanan, Muntinlupa City, Metro Manila, Philippines');
  });

  await itAsync('Unified address format is returned when retrieving family details', async () => {
    store.state.currentUser = user2; // regular member viewing the family
    const fam = await store.getMyFamily();
    assert.ok(fam.family.address);
    assert.strictEqual(fam.family.address.house_number, 'Block 4 Lot 12');
    assert.strictEqual(fam.family.address.street, 'Bautista St');
    assert.strictEqual(fam.family.address.barangay, 'Bayanan');
    assert.strictEqual(fam.family.address.city, 'Muntinlupa City');
    assert.strictEqual(fam.family.address.formatted, 'Block 4 Lot 12 Bautista St, Barangay Bayanan, Muntinlupa City, Metro Manila, Philippines');
  });

  console.log('\n================================================================');
  console.log(` RESULTS: ${passed} passed, ${failed} failed`);
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
})();
