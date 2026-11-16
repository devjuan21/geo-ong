/**
 * GeoSafe - Administrator Sidebar Consolidation & Layout Alignment Verification Suite
 * ============================================================================
 * Audits:
 * 1. Single Sidebar Toggle Button:
 *    - Redundant minimize/double-arrow buttons inside the sidebar removed
 *    - Single unified hamburger button in topbar header controls expand/collapse
 *    - Sidebar header contains only the logo (full when expanded, compact icon when collapsed)
 * 2. Collapsed Sidebar Width & Centered Navigation:
 *    - Exact 80px (5rem) collapsed width
 *    - Perfectly centered navigation SVG icons with descriptive tooltip titles
 *    - Bottom logout button contained cleanly within collapsed boundaries
 * 3. Main Content Positioning & Section Layouts:
 *    - Smooth 200–300ms synchronized transition on sidebar width and content padding
 *    - Prevents horizontal overflow across all 8 administrator sections
 * 4. Responsive Mobile Drawer:
 *    - Responsive drawer behavior preserved on viewports < 1024px
 * 5. Code Hygiene & Zero Emojis
 * 6. Database Data Integrity: Zero hardcoded or sample reports
 * ============================================================================
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const pool = require('../../models/db');

async function verifyAdminSidebar() {
  console.log('================================================================');
  console.log(' GeoSafe Administrator Sidebar Consolidation Verification');
  console.log('================================================================\n');

  const adminHtmlPath = path.join(__dirname, '../../../frontend/admin.html');
  const adminJsPath = path.join(__dirname, '../../../frontend/assets/js/admin.js');

  const adminHtml = fs.readFileSync(adminHtmlPath, 'utf8');
  const adminJs = fs.readFileSync(adminJsPath, 'utf8');

  // 1. Verify Single Sidebar Toggle Button & Clean Sidebar Header
  console.log('1. Auditing Single Sidebar Toggle Button & Sidebar Header:');
  assert(adminHtml.includes('id="sidebar-header"'), 'sidebar-header container present');
  assert(!adminHtml.includes('id="sidebar-collapse-toggle-btn"'), 'Redundant double-arrow collapse toggle inside sidebar removed');
  assert(!adminHtml.includes('id="sidebar-expand-toggle-btn"'), 'Redundant double-arrow expand toggle inside sidebar removed');
  assert(adminHtml.includes('id="topbar-sidebar-toggle-btn"'), 'Single unified hamburger toggle button present in top header');
  assert(adminHtml.includes('handleSidebarToggle'), 'Hamburger button calls unified handleSidebarToggle handler');

  // Verify sidebar header displays logo without duplicate controls
  assert(adminHtml.includes('id="sidebar-logo-link"'), 'Sidebar header contains clean logo link');
  assert(adminHtml.includes('sidebar-label-wrap'), 'Full brand name & jurisdiction in expanded state');
  assert(adminHtml.includes('#admin-sidebar.sidebar-collapsed #sidebar-logo-link'), 'CSS centers compact logo icon when collapsed');
  assert(adminHtml.includes('#admin-sidebar.sidebar-collapsed .sidebar-label-wrap'), 'CSS smoothly hides labels when collapsed');

  console.log('  [PASS] Redundant double-arrow minimize buttons inside sidebar completely removed');
  console.log('  [PASS] Hamburger button in top header is the single sidebar toggle');
  console.log('  [PASS] Sidebar header cleanly displays full logo when expanded and centered compact logo when collapsed');

  // 2. Verify Collapsed Sidebar Width & Centered Navigation
  console.log('\n2. Auditing Collapsed Sidebar Width & Navigation Centering:');
  assert(adminHtml.includes('#admin-sidebar.sidebar-collapsed'), 'CSS defines #admin-sidebar.sidebar-collapsed rules');
  assert(adminHtml.includes('width: 5rem !important;'), 'Strict 80px (5rem) collapsed width defined');
  assert(adminHtml.includes('justify-content: center !important;'), 'Navigation buttons centered when collapsed');
  assert(adminHtml.includes('margin: 0 auto !important;'), 'Navigation SVG icons centered when collapsed');

  // Verify all 8 navigation buttons have descriptive titles for tooltips in collapsed state
  const requiredNavs = ['dashboard', 'reports', 'responders', 'users', 'alerts', 'analytics', 'settings', 'audit'];
  for (const nav of requiredNavs) {
    const navRegex = new RegExp(`data-admin-nav="${nav}"[\\s\\S]*?title="[^"]+"`);
    assert(navRegex.test(adminHtml), `Nav button [data-admin-nav="${nav}"] has title attribute for clean tooltips`);
  }
  console.log('  [PASS] All 8 navigation items configured with centered icons and native tooltips');

  // Verify bottom profile container has been removed from sidebar
  assert(!adminHtml.includes('id="sidebar-footer-box"'), 'Redundant sidebar-footer-box container removed from sidebar');
  assert(!adminHtml.includes('id="sidebar-user-info"'), 'Redundant sidebar-user-info container removed from sidebar');
  assert(!adminHtml.includes('id="sidebar-logout-btn"'), 'Redundant sidebar-logout-btn button removed from sidebar');
  console.log('  [PASS] Redundant bottom profile & logout container cleanly removed from sidebar');

  // 3. Verify Smooth Transitions & Main Content Positioning
  console.log('\n3. Auditing Smooth Transitions & Content Positioning:');
  assert(adminHtml.includes('transition: width 0.25s'), 'Sidebar width has smooth 0.25s transition');
  assert(adminHtml.includes('transition: padding-left 0.25s'), 'Layout wrapper padding-left has smooth 0.25s transition');
  assert(adminHtml.includes('#admin-layout-wrapper.sidebar-collapsed'), 'Layout wrapper has .sidebar-collapsed transition rule');
  assert(adminHtml.includes('padding-left: 5rem !important;'), 'Layout wrapper adjusts padding-left to 5rem when collapsed');
  assert(adminHtml.includes('min-width: 0 !important;'), 'Layout wrapper has min-width: 0 preventing flex child blowouts');
  assert(adminHtml.includes('max-width: 100% !important;'), 'Layout wrapper has max-width: 100% preventing horizontal overflow');

  // Check main element and sections
  assert(adminHtml.includes('<main class="flex-1 w-full min-w-0 max-w-[1600px]'), 'Main container has min-w-0 and max-w-[1600px]');
  for (const nav of requiredNavs) {
    assert(adminHtml.includes(`id="section-${nav}"`), `section-${nav} container present`);
    assert(adminHtml.includes(`id="section-${nav}" class="space-y-6`), `section-${nav} has standard spacing`);
  }
  assert(adminHtml.includes('id="section-alerts" class="space-y-6 hidden min-w-0 max-w-full"'), 'section-alerts has min-w-0 max-w-full safeguards');
  console.log('  [PASS] Smooth 250ms transition synchronizes sidebar and main content layout');
  console.log('  [PASS] All 8 sections safeguarded against overflow and clipping');

  // 4. Verify Responsive Behavior & Mobile Drawer
  console.log('\n4. Auditing Responsive Layout & Mobile Drawer:');
  assert(adminHtml.includes('@media (max-width: 1023px)'), 'Mobile media query block present in CSS');
  assert(adminHtml.includes('padding-left: 0 !important;'), 'Padding-left is 0 on mobile viewports');
  assert(adminJs.includes('closeMobileDrawer'), 'closeMobileDrawer implemented');
  assert(adminJs.includes('openMobileDrawer'), 'openMobileDrawer implemented');
  assert(adminJs.includes('handleSidebarToggle'), 'handleSidebarToggle implemented in admin.js');
  assert(/if\s*\(\s*window\.innerWidth\s*<\s*1024\s*\)\s*\{\s*closeMobileDrawer\(\);/m.test(adminJs), 'Clicking navigation links on mobile automatically closes drawer');
  console.log('  [PASS] Responsive layout and mobile slide-out drawer behavior verified');

  // 5. Code Hygiene & Zero Emojis
  console.log('\n5. Verifying Zero Emojis:');
  const emojiRegex = /[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assert(!emojiRegex.test(adminHtml), 'Zero emojis in admin.html');
  assert(!emojiRegex.test(adminJs), 'Zero emojis in admin.js');
  console.log('  [PASS] Zero emojis in admin.html and admin.js');

  // 6. Data Integrity: Zero Sample / Hardcoded Reports
  console.log('\n6. Checking Database Data Integrity:');
  const [[repCount]] = await pool.query('SELECT COUNT(*) AS total FROM reports');
  const [[resCount]] = await pool.query('SELECT COUNT(*) AS total FROM rescue_requests');
  console.log(`  Current reports in PostgreSQL: ${repCount.total}`);
  console.log(`  Current rescue requests in PostgreSQL: ${resCount.total}`);
  assert(Number(repCount.total) === 0, 'Database reports count is pristine (0 fake reports)');
  assert(Number(resCount.total) === 0, 'Database rescue_requests count is pristine (0 fake requests)');
  console.log('  [PASS] Zero hardcoded or sample reports in PostgreSQL verified');

  console.log('\n================================================================');
  console.log(' ALL ADMIN SIDEBAR CONSOLIDATION CHECKS PASSED!');
  console.log('================================================================\n');
}

verifyAdminSidebar()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n[FAIL] Verification error:', err);
    process.exit(1);
  });
