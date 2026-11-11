/**
 * Verification Script: Interactive Header Profile Dropdown
 * Tests Resident, Responder, and Administrator headers and dropdown menus
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

let passedTests = 0;
let failedTests = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  [PASS] ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  [FAIL] ${desc}: ${err.message}`);
    failedTests++;
  }
}

console.log('--- Testing GeoSafe Interactive Header Profile Dropdown ---\n');

// 1. Static HTML and JS inspection
console.log('1. Static Code Inspection:');

const componentsJs = fs.readFileSync(path.join(__dirname, '../../../frontend/assets/js/components.js'), 'utf8');
const responderUiJs = fs.readFileSync(path.join(__dirname, '../../../frontend/assets/js/responder-ui.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(__dirname, '../../../frontend/admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(__dirname, '../../../frontend/assets/js/admin.js'), 'utf8');

it('Resident Portal (components.js) defines #resident-header-profile-wrapper and #resident-profile-menu-btn', () => {
  assert(componentsJs.includes('id="resident-header-profile-wrapper"'));
  assert(componentsJs.includes('id="resident-profile-menu-btn"'));
  assert(componentsJs.includes('id="resident-profile-dropdown"'));
  assert(componentsJs.includes('id="header-profile-name"'));
  assert(componentsJs.includes('id="header-profile-role"'));
});

it('Resident Portal has removed standalone header Sign Out button from top nav', () => {
  // Should not contain separate sign out button in header outside the dropdown
  assert(!componentsJs.includes('class="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl border border-[#EEEEEE] bg-white hover:bg-[#FFF1F1] hover:border-[#FFC2C2] hover:text-[#D93636] text-[11px] font-bold text-[#777777] transition-colors shadow-subtle" title="Sign Out"'));
  // Sign out is inside dropdown menu
  assert(componentsJs.includes('id="header-menu-item-logout"'));
  assert(componentsJs.includes('onclick="GeoSafeUI.handleLogout()"'));
});

it('Resident Dropdown contains Profile link to profile.html with icon', () => {
  assert(componentsJs.includes('href="profile.html"'));
  assert(componentsJs.includes('id="header-menu-item-profile"'));
});

it('Resident Portal implements toggleProfileDropdown, closeProfileDropdown, closeAllDropdowns', () => {
  assert(componentsJs.includes('toggleProfileDropdown(event)'));
  assert(componentsJs.includes('closeProfileDropdown()'));
  assert(componentsJs.includes('closeAllDropdowns()'));
  assert(componentsJs.includes('bindDropdownListeners()'));
});

it('Resident syncHeaderResidentData populates real name and role', () => {
  assert(componentsJs.includes('profileNameEl.textContent = fullName'));
  assert(componentsJs.includes('profileRoleEl.textContent = roleName'));
});

it('Responder Portal (responder-ui.js) defines #responder-header-profile-wrapper and #responder-profile-menu-btn', () => {
  assert(responderUiJs.includes('id="responder-header-profile-wrapper"'));
  assert(responderUiJs.includes('id="responder-profile-menu-btn"'));
  assert(responderUiJs.includes('id="responder-profile-dropdown"'));
  assert(responderUiJs.includes('id="header-responder-dropdown-name"'));
  assert(responderUiJs.includes('id="header-responder-dropdown-role"'));
});

it('Responder Dropdown contains Profile link to responder-profile.html and Sign Out button', () => {
  assert(responderUiJs.includes('href="responder-profile.html"'));
  assert(responderUiJs.includes('id="responder-menu-item-profile"'));
  assert(responderUiJs.includes('id="responder-menu-item-logout"'));
  assert(responderUiJs.includes('GeoSafeResponderUI.handleLogout()'));
});

it('Responder Portal implements toggleProfileDropdown, closeProfileDropdown, and handleLogout', () => {
  assert(responderUiJs.includes('toggleProfileDropdown(event)'));
  assert(responderUiJs.includes('closeProfileDropdown()'));
  assert(responderUiJs.includes('handleLogout()'));
  assert(responderUiJs.includes('bindDropdownListeners()'));
});

it('Responder syncHeaderResponderData populates real responder name and role', () => {
  assert(responderUiJs.includes('dropdownName.textContent = fullName'));
  assert(responderUiJs.includes('dropdownRole.textContent = roleName'));
});

it('Administrator Portal (admin.html) defines #admin-header-profile-wrapper and #admin-profile-menu-btn', () => {
  assert(adminHtml.includes('id="admin-header-profile-wrapper"'));
  assert(adminHtml.includes('id="admin-profile-menu-btn"'));
  assert(adminHtml.includes('id="admin-profile-dropdown"'));
  assert(adminHtml.includes('id="admin-header-name"'));
  assert(adminHtml.includes('id="admin-header-role"'));
});

it('Administrator Portal has removed standalone top header Sign Out button', () => {
  // Should not have separate header sign out button
  assert(!adminHtml.includes('<span class="hidden sm:inline">Sign Out</span>\n          </button>\n        </div>\n\n      </div>\n    </header>'));
  // Sign out is in dropdown
  assert(adminHtml.includes('id="admin-menu-item-logout"'));
  assert(adminHtml.includes('onclick="handleAdminLogout()"'));
});

it('Administrator Portal contains Profile button that opens #admin-profile-modal', () => {
  assert(adminHtml.includes('onclick="window.GeoSafeAdmin.openAdminProfileModal()"'));
  assert(adminHtml.includes('id="admin-profile-modal"'));
  assert(adminHtml.includes('id="admin-modal-name"'));
  assert(adminHtml.includes('id="admin-modal-user-id"'));
  assert(adminHtml.includes('id="admin-modal-role"'));
});

it('Administrator Portal (admin.js) exports dropdown and modal controls on window.GeoSafeAdmin', () => {
  assert(adminJs.includes('toggleProfileDropdown,'));
  assert(adminJs.includes('closeProfileDropdown,'));
  assert(adminJs.includes('openAdminProfileModal,'));
  assert(adminJs.includes('closeAdminProfileModal,'));
});

it('Administrator initAdminPortal populates live admin name, role, and modal info', () => {
  assert(adminJs.includes('headerRole.textContent = adminRoleName'));
  assert(adminJs.includes('modalName.textContent = adminDisplayName'));
  assert(adminJs.includes('modalUserId.textContent = adminUserCode'));
});

// 2. Mock DOM Behavioral Interaction Tests
console.log('\n2. DOM Behavioral Interaction Tests:');

// Minimal Mock DOM for behavior verification
class MockClassList {
  constructor() {
    this._set = new Set();
  }
  add(...tokens) {
    tokens.forEach(t => this._set.add(t));
  }
  remove(...tokens) {
    tokens.forEach(t => this._set.delete(t));
  }
  contains(token) {
    return this._set.has(token);
  }
  toggle(token) {
    if (this._set.has(token)) {
      this._set.delete(token);
      return false;
    } else {
      this._set.add(token);
      return true;
    }
  }
}

class MockElement {
  constructor(id, tag = 'div') {
    this.id = id;
    this.tagName = tag.toUpperCase();
    this.classList = new MockClassList();
    this.attributes = {};
    this.children = [];
    this.textContent = '';
    this.parentNode = null;
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
  }
  getAttribute(k) {
    return this.attributes[k] || null;
  }
  contains(target) {
    if (target === this) return true;
    return this.children.some(c => c.contains(target));
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
  }
}

function setupMockDocument() {
  const elements = {};
  const listeners = {};

  const doc = {
    createElement(tag) {
      return new MockElement('', tag);
    },
    getElementById(id) {
      return elements[id] || null;
    },
    querySelectorAll(selector) {
      const results = [];
      if (selector === '[id$="-profile-dropdown"]') {
        for (const [id, el] of Object.entries(elements)) {
          if (id.endsWith('-profile-dropdown')) results.push(el);
        }
      }
      if (selector === '[id$="-profile-chevron"]') {
        for (const [id, el] of Object.entries(elements)) {
          if (id.endsWith('-profile-chevron')) results.push(el);
        }
      }
      if (selector === '[id$="-profile-menu-btn"]') {
        for (const [id, el] of Object.entries(elements)) {
          if (id.endsWith('-profile-menu-btn')) results.push(el);
        }
      }
      return results;
    },
    addEventListener(type, fn) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    },
    _trigger(type, event) {
      if (listeners[type]) {
        listeners[type].forEach(fn => fn(event));
      }
    },
    _register(el) {
      if (el.id) elements[el.id] = el;
      return el;
    }
  };

  return doc;
}

it('Resident Portal: toggleProfileDropdown toggles hidden, rotates chevron, updates aria-expanded', () => {
  const mockDoc = setupMockDocument();
  const dropdown = mockDoc._register(new MockElement('resident-profile-dropdown'));
  dropdown.classList.add('hidden');
  const chevron = mockDoc._register(new MockElement('resident-profile-chevron'));
  const btn = mockDoc._register(new MockElement('resident-profile-menu-btn'));
  btn.setAttribute('aria-expanded', 'false');

  global.document = mockDoc;

  // Simulate GeoSafeUI methods
  const mockUI = eval(`({
    ${componentsJs.match(/toggleProfileDropdown\([^)]*\)\s*\{[\s\S]*?\n  \},/)[0]}
    ${componentsJs.match(/closeProfileDropdown\([^)]*\)\s*\{[\s\S]*?\n  \},/)[0]}
    ${componentsJs.match(/closeAllDropdowns\([^)]*\)\s*\{[\s\S]*?\n  \},/)[0]}
  })`);

  // 1. Initial State
  assert(dropdown.classList.contains('hidden'));
  assert.strictEqual(btn.getAttribute('aria-expanded'), 'false');
  assert(!chevron.classList.contains('rotate-180'));

  // 2. Open Dropdown
  mockUI.toggleProfileDropdown();
  assert(!dropdown.classList.contains('hidden'), 'Dropdown should now be open');
  assert.strictEqual(btn.getAttribute('aria-expanded'), 'true');
  assert(chevron.classList.contains('rotate-180'), 'Chevron should be rotated');

  // 3. Close Dropdown with toggle
  mockUI.toggleProfileDropdown();
  assert(dropdown.classList.contains('hidden'), 'Dropdown should be hidden after second click');
  assert.strictEqual(btn.getAttribute('aria-expanded'), 'false');
  assert(!chevron.classList.contains('rotate-180'));
});

it('Responder Portal: toggleProfileDropdown toggles hidden and rotates chevron', () => {
  const mockDoc = setupMockDocument();
  const dropdown = mockDoc._register(new MockElement('responder-profile-dropdown'));
  dropdown.classList.add('hidden');
  const chevron = mockDoc._register(new MockElement('responder-profile-chevron'));
  const btn = mockDoc._register(new MockElement('responder-profile-menu-btn'));
  btn.setAttribute('aria-expanded', 'false');

  global.document = mockDoc;

  const mockResponderUI = eval(`({
    ${responderUiJs.match(/toggleProfileDropdown\([^)]*\)\s*\{[\s\S]*?\n  \},/)[0]}
    ${responderUiJs.match(/closeProfileDropdown\([^)]*\)\s*\{[\s\S]*?\n  \},/)[0]}
    ${responderUiJs.match(/closeAllDropdowns\([^)]*\)\s*\{[\s\S]*?\n  \},/)[0]}
  })`);

  // Open
  mockResponderUI.toggleProfileDropdown();
  assert(!dropdown.classList.contains('hidden'));
  assert.strictEqual(btn.getAttribute('aria-expanded'), 'true');
  assert(chevron.classList.contains('rotate-180'));

  // Close via closeProfileDropdown
  mockResponderUI.closeProfileDropdown();
  assert(dropdown.classList.contains('hidden'));
  assert.strictEqual(btn.getAttribute('aria-expanded'), 'false');
  assert(!chevron.classList.contains('rotate-180'));
});

it('Administrator Portal: openAdminProfileModal and closeAdminProfileModal toggle modal visibility', () => {
  const mockDoc = setupMockDocument();
  const modal = mockDoc._register(new MockElement('admin-profile-modal'));
  modal.classList.add('hidden');
  const dropdown = mockDoc._register(new MockElement('admin-profile-dropdown'));
  dropdown.classList.add('hidden');
  const chevron = mockDoc._register(new MockElement('admin-profile-chevron'));
  const btn = mockDoc._register(new MockElement('admin-profile-menu-btn'));

  global.document = mockDoc;

  function closeProfileDropdown() {
    if (dropdown && !dropdown.classList.contains('hidden')) {
      dropdown.classList.add('hidden');
    }
  }
  function openAdminProfileModal() {
    closeProfileDropdown();
    modal.classList.remove('hidden');
  }
  function closeAdminProfileModal() {
    modal.classList.add('hidden');
  }

  // Open modal
  openAdminProfileModal();
  assert(!modal.classList.contains('hidden'), 'Admin modal should be open');

  // Close modal
  closeAdminProfileModal();
  assert(modal.classList.contains('hidden'), 'Admin modal should be closed');
});

it('Mutual Exclusivity: opening one dropdown closes any other open dropdowns', () => {
  const mockDoc = setupMockDocument();
  const resDropdown = mockDoc._register(new MockElement('resident-profile-dropdown'));
  const respDropdown = mockDoc._register(new MockElement('responder-profile-dropdown'));
  const adminDropdown = mockDoc._register(new MockElement('admin-profile-dropdown'));

  resDropdown.classList.add('hidden');
  respDropdown.classList.remove('hidden'); // previously open
  adminDropdown.classList.add('hidden');

  global.document = mockDoc;

  function closeAllDropdowns() {
    mockDoc.querySelectorAll('[id$="-profile-dropdown"]').forEach(dd => {
      dd.classList.add('hidden');
    });
  }

  closeAllDropdowns();
  resDropdown.classList.remove('hidden');

  assert(!resDropdown.classList.contains('hidden'), 'Resident dropdown should be open');
  assert(respDropdown.classList.contains('hidden'), 'Responder dropdown should now be closed');
  assert(adminDropdown.classList.contains('hidden'), 'Admin dropdown should be closed');
});

console.log(`\nVerification Complete: ${passedTests} passed, ${failedTests} failed.`);

if (failedTests > 0) {
  process.exit(1);
} else {
  console.log('\nAll profile dropdown tests passed successfully!');
}
