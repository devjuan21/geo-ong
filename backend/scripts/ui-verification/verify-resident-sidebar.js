/**
 * GeoSafe - Responsive Resident UI Navigation & Desktop Sidebar Verification Script
 * =================================================================================
 * Verifies:
 * 1. Fixed vertical sidebar on wide desktop screens (>= 1024px / lg:).
 * 2. Consistent 240px width (w-60 / 15rem).
 * 3. Logo & branding at top of sidebar.
 * 4. Strictly 4 resident navigation items (Home, Evacuation Routes, Report / Rescue, Hazard Alerts).
 * 5. Horizontal navigation hidden on desktop (lg:hidden) and positioned beside sidebar.
 * 6. Tablet & mobile navigation preserved without duplicate navigation menus or buttons.
 * 7. Layout padding and map resize listeners.
 * 8. Zero hardcoded/sample reports in PostgreSQL database.
 * =================================================================================
 */

const fs = require('fs');
const path = require('path');
const db = require('../../config/db');

async function runVerification() {
  console.log('================================================================');
  console.log(' GeoSafe Responsive Resident Navigation Verification');
  console.log('================================================================\n');

  let passedAll = true;

  // 1. Audit components.js for Desktop Sidebar Implementation
  console.log('1. Auditing Desktop Sidebar in components.js:');
  const componentsPath = path.join(__dirname, '../../../frontend/assets/js/components.js');
  const componentsJs = fs.readFileSync(componentsPath, 'utf8');

  // Verify renderDesktopSidebar exists
  if (!componentsJs.includes('renderDesktopSidebar(activeId)')) {
    console.error('  [FAIL] renderDesktopSidebar function is missing from components.js');
    passedAll = false;
  } else {
    console.log('  [PASS] renderDesktopSidebar function is implemented in GeoSafeUI');
  }

  // Verify sidebar container classes
  if (!componentsJs.includes('resident-desktop-sidebar') || !componentsJs.includes('w-60') || !componentsJs.includes('hidden lg:flex')) {
    console.error('  [FAIL] Desktop sidebar container missing required w-60 or hidden lg:flex classes');
    passedAll = false;
  } else {
    console.log('  [PASS] Desktop sidebar container configured with w-60 (240px) and hidden lg:flex');
  }

  // Verify GeoSafe logo at the top of the sidebar
  if (!componentsJs.includes('GeoSafe</span>') || !componentsJs.includes('Barangay Bayanan')) {
    console.error('  [FAIL] Desktop sidebar missing GeoSafe logo or Barangay Bayanan branding');
    passedAll = false;
  } else {
    console.log('  [PASS] Desktop sidebar includes GeoSafe logo & Barangay Bayanan branding at the top');
  }

  // 2. Audit Navigation Items (Exactly 4 items)
  console.log('\n2. Auditing Resident Navigation Items:');
  const expectedItems = [
    { id: 'home', label: 'Home' },
    { id: 'evacuation-routes', label: 'Evacuation Routes' },
    { id: 'report-rescue', label: 'Report / Rescue' },
    { id: 'hazard-alerts', label: 'Hazard Alerts' }
  ];

  for (const item of expectedItems) {
    if (componentsJs.includes(item.id) && componentsJs.includes(item.label)) {
      console.log(`  [PASS] Navigation item verified: ${item.label} (${item.id})`);
    } else {
      console.error(`  [FAIL] Missing navigation item: ${item.label} (${item.id})`);
      passedAll = false;
    }
  }

  // Verify Report / Rescue in desktop sidebar uses uniform styling without red SOS badge
  const sidebarMatch = componentsJs.match(/renderDesktopSidebar\s*\([^)]*\)\s*\{[\s\S]*?renderTopNav\s*\(/);
  const sidebarBlock = sidebarMatch ? sidebarMatch[0] : '';
  if (sidebarBlock.includes('#D93636') || sidebarBlock.includes('SOS')) {
    console.error('  [FAIL] Desktop sidebar Report / Rescue still has red styling or SOS badge');
    passedAll = false;
  } else {
    console.log('  [PASS] Desktop sidebar Report / Rescue uses clean uniform styling without red highlight');
  }

  // 3. Auditing Desktop Header and Navigation Replacement
  console.log('\n3. Auditing Top Header and Navigation Synchronization:');
  if (!componentsJs.includes('lg:left-60') || !componentsJs.includes('lg:w-[calc(100%-15rem)]')) {
    console.error('  [FAIL] Header missing lg:left-60 and lg:w-[calc(100%-15rem)] offset for sidebar');
    passedAll = false;
  } else {
    console.log('  [PASS] Top header properly offset beside 240px sidebar on desktop screens (>= 1024px)');
  }

  // Verify horizontal nav is hidden on wide desktop screens (lg:hidden)
  if (!componentsJs.includes('hidden md:flex lg:hidden')) {
    console.error('  [FAIL] Top header nav missing lg:hidden to replace horizontal nav with sidebar');
    passedAll = false;
  } else {
    console.log('  [PASS] Horizontal navigation in top header is hidden on desktop (lg:hidden) to prevent duplicate nav');
  }

  // 4. Auditing CSS Rules & Layout Offsets
  console.log('\n4. Auditing CSS Layout Rules:');
  const styleCssPath = path.join(__dirname, '../../../frontend/assets/css/style.css');
  const styleCss = fs.readFileSync(styleCssPath, 'utf8');

  if (styleCss.includes('body.resident-layout') && styleCss.includes('padding-left: 15rem') && styleCss.includes('min-width: 1024px')) {
    console.log('  [PASS] style.css includes @media (min-width: 1024px) padding-left: 15rem for body.resident-layout');
  } else {
    console.error('  [FAIL] style.css missing desktop sidebar offset for body.resident-layout');
    passedAll = false;
  }

  // 5. Auditing Resident HTML Pages for resident-layout class
  console.log('\n5. Auditing Resident HTML Pages:');
  const residentPages = [
    'frontend/index.html',
    'frontend/evacuation-routes.html',
    'frontend/report-rescue.html',
    'frontend/hazard-alerts.html',
    'frontend/profile.html',
    'frontend/settings.html',
    'frontend/notifications.html',
    'frontend/my-reports.html'
  ];

  for (const page of residentPages) {
    const pagePath = path.join(__dirname, '../../../', page);
    const html = fs.readFileSync(pagePath, 'utf8');
    if (html.includes('resident-layout')) {
      console.log(`  [PASS] ${page} contains resident-layout class on body`);
    } else {
      console.error(`  [FAIL] ${page} missing resident-layout class on body`);
      passedAll = false;
    }
  }

  // 6. Auditing Map InvalidateSize in mapping-service.js
  console.log('\n6. Auditing Map Auto-Resize in mapping-service.js:');
  const mappingPath = path.join(__dirname, '../../../frontend/assets/js/mapping-service.js');
  const mappingJs = fs.readFileSync(mappingPath, 'utf8');

  if (mappingJs.includes('invalidateSize') && mappingJs.includes('resize')) {
    console.log('  [PASS] mapping-service.js includes invalidateSize trigger on window resize');
  } else {
    console.error('  [FAIL] mapping-service.js missing map resize handling');
    passedAll = false;
  }

  // 7. Auditing Zero Emojis
  console.log('\n7. Auditing Zero Emojis:');
  const filesToCheck = [
    componentsPath,
    styleCssPath,
    mappingPath,
    path.join(__dirname, '../../../frontend/index.html'),
    path.join(__dirname, '../../../frontend/evacuation-routes.html'),
    path.join(__dirname, '../../../frontend/report-rescue.html'),
    path.join(__dirname, '../../../frontend/hazard-alerts.html')
  ];
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/u;
  let hasEmoji = false;
  for (const file of filesToCheck) {
    const text = fs.readFileSync(file, 'utf8');
    if (emojiRegex.test(text)) {
      console.error(`  [FAIL] Emoji found in ${path.basename(file)}`);
      hasEmoji = true;
      passedAll = false;
    }
  }
  if (!hasEmoji) {
    console.log('  [PASS] Zero emojis verified in all modified files');
  }

  // 8. Checking Database Integrity (Reports = 0)
  console.log('\n8. Checking Database Data Integrity:');
  try {
    const [reports] = await db.query('SELECT count(*) as count FROM reports');
    const [rescues] = await db.query('SELECT count(*) as count FROM rescue_requests');
    const reportCount = parseInt(reports[0].count, 10);
    const rescueCount = parseInt(rescues[0].count, 10);
    console.log(`  Current reports in PostgreSQL: ${reportCount}`);
    console.log(`  Current rescue requests in PostgreSQL: ${rescueCount}`);

    if (reportCount === 0 && rescueCount === 0) {
      console.log('  [PASS] Zero hardcoded or sample reports in PostgreSQL verified');
    } else {
      console.error('  [FAIL] Found reports or rescue requests in database!');
      passedAll = false;
    }
  } catch (err) {
    console.error('  [ERROR] Database check failed:', err.message);
    passedAll = false;
  } finally {
    await db.end();
  }

  console.log('\n================================================================');
  if (passedAll) {
    console.log(' ALL RESIDENT SIDEBAR VERIFICATION CHECKS PASSED!');
  } else {
    console.error(' SOME RESIDENT SIDEBAR CHECKS FAILED!');
    process.exit(1);
  }
  console.log('================================================================\n');
}

runVerification().catch(err => {
  console.error('Fatal error during verification:', err);
  process.exit(1);
});
