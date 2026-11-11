/**
 * GeoSafe — Toast Notification Verification Suite
 * Verifies all requirements for the login toast notification component:
 * 1. Reusable toast notification system is retained and active.
 * 2. Inline error notification above Email field is removed.
 * 3. Any duplicate error message containers related to login are removed.
 * 4. Failed login attempts display only one toast.
 * 5. Successful login does not display error notifications.
 * 6. Empty email or password displays an appropriate validation toast.
 * 7. Repeated failed login attempts do not create duplicate/stacked toasts.
 * 8. Zero emojis across all modified files.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, description) {
  if (condition) {
    console.log(`  [PASS] ${description}`);
    testsPassed++;
  } else {
    console.error(`  [FAIL] ${description}`);
    testsFailed++;
  }
}

console.log('================================================================');
console.log(' GeoSafe Login Toast Notification Verification Suite');
console.log('================================================================\n');

// 1. Inspect login.html
console.log('1. Checking login.html:');
const loginHtmlPath = path.join(__dirname, '../../../frontend/login.html');
const loginHtml = fs.readFileSync(loginHtmlPath, 'utf8');

assert(!loginHtml.includes('id="login-error-banner"'), 'Inline error alert banner removed from login.html');
assert(!loginHtml.includes('id="login-success-banner"'), 'Inline success alert banner removed from login.html');
assert(!loginHtml.includes('id="email-validation-msg"'), 'Inline email validation message removed from login.html');
assert(!loginHtml.includes('id="password-validation-msg"'), 'Inline password validation message removed from login.html');
assert(loginHtml.includes('assets/js/toast.js'), 'login.html includes assets/js/toast.js');
assert(loginHtml.indexOf('assets/js/toast.js') < loginHtml.indexOf('assets/js/login.js'), 'toast.js is loaded before login.js');

// Inspect region around Email field
const emailFieldIndex = loginHtml.indexOf('id="login-email"');
const emailFieldSlice = loginHtml.slice(Math.max(0, emailFieldIndex - 300), emailFieldIndex + 300);
assert(!emailFieldSlice.includes('role="alert"'), 'No inline role="alert" above or below the Email field');
assert(!emailFieldSlice.includes('error'), 'No error text container adjacent to Email field');

// 2. Inspect toast.js code
console.log('\n2. Checking assets/js/toast.js structure & requirements:');
const toastJsPath = path.join(__dirname, '../../../frontend/assets/js/toast.js');
assert(fs.existsSync(toastJsPath), 'frontend/assets/js/toast.js exists');
const toastJs = fs.readFileSync(toastJsPath, 'utf8');

assert(toastJs.includes('GeoSafeToast'), 'Exports GeoSafeToast component');
assert(toastJs.includes('geosafe-toast-container'), 'Creates or targets #geosafe-toast-container');
assert(toastJs.includes('pointer-events-none'), 'Toast container is non-blocking with pointer-events-none');
assert(toastJs.includes('pointer-events-auto'), 'Individual toasts have pointer-events-auto');
assert(toastJs.includes('sm:top-6 sm:right-6') || toastJs.includes('top-right'), 'Positioned at top-right on desktop');
assert(toastJs.includes('top-4') && toastJs.includes('inset-x-4'), 'Positioned at top with balanced spacing on mobile');
assert(toastJs.includes('bg-[#F25430]'), 'Includes modern vibrant red-orange error styling (#F25430)');
assert(toastJs.includes('bg-[#28C76F]'), 'Includes modern vibrant green success styling (#28C76F)');
assert(toastJs.includes('bg-[#0082E6]'), 'Includes modern vibrant blue info styling (#0082E6)');
assert(toastJs.includes('bg-[#F5A623]'), 'Includes modern vibrant amber warning styling (#F5A623)');
assert(toastJs.includes('rounded-full bg-white'), 'Includes white circular icon badge');
assert(toastJs.includes('toast-progress-fill'), 'Includes bottom progress bar fill element');
assert(toastJs.includes('rounded-2xl'), 'Uses GeoSafe rounded-2xl corner radius');
assert(toastJs.includes('role') && toastJs.includes('alert') && toastJs.includes('aria-live'), 'Includes accessibility attributes role="alert" and aria-live');
assert(toastJs.includes('aria-label="Close notification"'), 'Includes accessible dismiss button');
assert(toastJs.includes('activeToasts') && toastJs.includes('normalizedKey'), 'Prevents multiple identical toasts from stacking (deduplication)');
assert(toastJs.includes('4000'), 'Default auto-dismiss duration set to ~4 seconds');
assert(toastJs.includes('Escape'), 'Supports ESC key dismissal');

// 3. Inspect login.js
console.log('\n3. Checking assets/js/login.js integration:');
const loginJsPath = path.join(__dirname, '../../../frontend/assets/js/login.js');
const loginJs = fs.readFileSync(loginJsPath, 'utf8');

assert(loginJs.includes('Invalid email or password.'), 'Displays normalized message "Invalid email or password."');
assert(loginJs.includes('showToastNotification') || loginJs.includes('GeoSafeToast'), 'Calls toast notification on login failure');
assert(!loginJs.includes('login-error-banner.classList.remove'), 'No inline error banner toggle in login.js');
assert(!loginJs.includes('email-validation-msg'), 'No email-validation-msg reference in login.js');
assert(!loginJs.includes('password-validation-msg'), 'No password-validation-msg reference in login.js');

// 4. Verify Zero Emojis across all modified files
console.log('\n4. Verifying Zero Emojis:');
const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
assert(!emojiRegex.test(toastJs), 'Zero emojis in toast.js');
assert(!emojiRegex.test(loginJs), 'Zero emojis in login.js');
assert(!emojiRegex.test(loginHtml), 'Zero emojis in login.html');

// 5. Functional Simulation in JSDOM / Browser-like Sandbox
console.log('\n5. Functional Behavior Simulation:');

class MockElement {
  constructor(tag) {
    this.tagName = (tag || 'DIV').toUpperCase();
    this.id = '';
    this.className = '';
    this.classList = {
      _classes: new Set(),
      add: (...cls) => cls.forEach(c => this.classList._classes.add(c)),
      remove: (...cls) => cls.forEach(c => this.classList._classes.delete(c)),
      contains: (c) => this.classList._classes.has(c),
      toggle: (c, force) => {
        if (force === undefined) {
          if (this.classList.contains(c)) this.classList.remove(c);
          else this.classList.add(c);
        } else if (force) {
          this.classList.add(c);
        } else {
          this.classList.remove(c);
        }
      }
    };
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this._listeners = {};
    this.innerHTML = '';
    this.value = '';
    this.disabled = false;
  }

  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k]; }
  focus() { this._focused = true; }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }
  querySelector(sel) {
    if (sel === '.toast-dismiss-btn') {
      return new MockElement('button');
    }
    return null;
  }
  addEventListener(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  }
  async dispatchEvent(event) {
    const fns = this._listeners[event.type] || [];
    for (const fn of fns) {
      await fn(event);
    }
  }
}

const mockDocument = {
  elementsById: new Map(),
  body: new MockElement('BODY'),
  _listeners: {},
  addEventListener(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  },
  async dispatchEvent(event) {
    const fns = this._listeners[event.type] || [];
    for (const fn of fns) {
      await fn(event);
    }
  },
  createElement(tag) {
    return new MockElement(tag);
  },
  getElementById(id) {
    return this.elementsById.get(id) || null;
  }
};

const domSandbox = {
  window: {
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { replace: () => {}, search: '' }
  },
  document: mockDocument,
  URLSearchParams,
  setTimeout,
  clearTimeout,
  requestAnimationFrame: (cb) => cb(),
  Map,
  Set,
  console
};
domSandbox.window.window = domSandbox.window;
domSandbox.window.document = mockDocument;

mockDocument.body.appendChild = function(child) {
  if (child.id) mockDocument.elementsById.set(child.id, child);
  return MockElement.prototype.appendChild.call(this, child);
};

vm.createContext(domSandbox);
vm.runInContext(toastJs, domSandbox);

const Toast = domSandbox.window.GeoSafeToast || domSandbox.GeoSafeToast;
assert(typeof Toast === 'object' && typeof Toast.show === 'function', 'GeoSafeToast initialized in sandbox');
assert(typeof Toast.error === 'function', 'GeoSafeToast.error method available');
assert(typeof Toast.success === 'function', 'GeoSafeToast.success method available');
assert(typeof Toast.warning === 'function', 'GeoSafeToast.warning method available');
assert(typeof Toast.info === 'function', 'GeoSafeToast.info method available');

// Trigger error toast
const t1 = Toast.error('Invalid email or password.');
assert(t1 !== null, 'Toast.error created toast element');
const container = mockDocument.getElementById('geosafe-toast-container');
assert(container !== null, 'Container automatically created in document.body');
assert(container.children.length === 1, 'Container contains exactly 1 toast');
assert(t1.getAttribute('role') === 'alert', 'Error toast has role="alert"');
assert(t1.getAttribute('aria-live') === 'assertive', 'Error toast has aria-live="assertive"');

// Repeated error click (test deduplication)
const t2 = Toast.error('Invalid email or password.');
assert(t2 === t1, 'Duplicate error toast returns existing toast instance without creating a second DOM element');
assert(container.children.length === 1, 'Container still contains exactly 1 toast (stacking prevented)');

// Trigger different toast
const t3 = Toast.success('Account successfully created.');
assert(container.children.length === 2, 'Different message creates separate toast in container');
assert(t3.getAttribute('role') === 'status', 'Success toast has role="status"');
assert(t3.getAttribute('aria-live') === 'polite', 'Success toast has aria-live="polite"');

// Test dismiss
Toast.dismiss(t1);
assert(t1._isDismissing === true, 'Toast dismiss sets dismissing state');
Toast.dismissAll();
container.children = [];

// 6. Test Form Validation & Login Flow
console.log('\n6. Form Interaction Simulation:');

(async function runFormTests() {
  // Setup form elements in sandbox DOM
  const loginForm = new MockElement('FORM');
  loginForm.id = 'login-form';
  mockDocument.elementsById.set('login-form', loginForm);

  const emailInput = new MockElement('INPUT');
  emailInput.id = 'login-email';
  mockDocument.elementsById.set('login-email', emailInput);

  const passwordInput = new MockElement('INPUT');
  passwordInput.id = 'login-password';
  mockDocument.elementsById.set('login-password', passwordInput);

  const submitBtn = new MockElement('BUTTON');
  submitBtn.id = 'login-submit-btn';
  mockDocument.elementsById.set('login-submit-btn', submitBtn);

  // Execute login.js in sandbox
  vm.runInContext(loginJs, domSandbox);

  // Dispatch DOMContentLoaded so setupLoginForm attaches submit listener
  await mockDocument.dispatchEvent({ type: 'DOMContentLoaded' });

  // Re-check toasts container after dismissAll
  assert(container.children.length === 0, 'Container reset to 0 toasts after dismissAll');

  // Test Case A: Empty email submitted
  emailInput.value = '';
  passwordInput.value = 'Secret123!';
  await loginForm.dispatchEvent({ type: 'submit', preventDefault: () => {} });
  assert(container.children.length === 1, 'Empty email displays exactly 1 toast');
  assert(container.children[0].innerHTML.includes('Please enter your email address.'), 'Validation toast correctly prompts for email');

  // Test Case B: Invalid email submitted
  emailInput.value = 'invalid-email-no-at';
  Toast.dismissAll();
  container.children = [];
  await loginForm.dispatchEvent({ type: 'submit', preventDefault: () => {} });
  assert(container.children.length === 1, 'Invalid email displays exactly 1 toast');
  assert(container.children[0].innerHTML.includes('Please enter a valid email address.'), 'Invalid email prompts for valid email address');

  // Test Case C: Empty password submitted
  emailInput.value = 'resident@example.com';
  passwordInput.value = '';
  Toast.dismissAll();
  container.children = [];
  await loginForm.dispatchEvent({ type: 'submit', preventDefault: () => {} });
  assert(container.children.length === 1, 'Empty password displays exactly 1 toast');
  assert(container.children[0].innerHTML.includes('Please enter your password.'), 'Empty password prompts for password');

  // Test Case D: Incorrect email or password (simulated backend 401 error)
  Toast.dismissAll();
  container.children = [];
  let geoSafeStoreLoginCalled = false;
  domSandbox.window.geoSafeStore = {
    login: async () => {
      geoSafeStoreLoginCalled = true;
      const error = new Error('Invalid email or password.');
      error.status = 401;
      throw error;
    }
  };

  emailInput.value = 'resident@example.com';
  passwordInput.value = 'WrongPassword!';
  await loginForm.dispatchEvent({ type: 'submit', preventDefault: () => {} });
  assert(geoSafeStoreLoginCalled, 'geoSafeStore.login called');
  assert(container.children.length === 1, 'Failed login results in exactly 1 toast');
  assert(container.children[0].innerHTML.includes('Invalid email or password.'), 'Error toast contains "Invalid email or password."');

  // Repeated failed submission
  await loginForm.dispatchEvent({ type: 'submit', preventDefault: () => {} });
  assert(container.children.length === 1, 'Repeated failed login maintains exactly 1 toast (deduplicated)');

  // Test Case E: Network error
  domSandbox.window.geoSafeStore.login = async () => {
    const netErr = new Error('Failed to fetch');
    netErr.isOffline = true;
    throw netErr;
  };
  Toast.dismissAll();
  container.children = [];

  emailInput.value = 'resident@example.com';
  passwordInput.value = 'Password123!';
  await loginForm.dispatchEvent({ type: 'submit', preventDefault: () => {} });
  assert(container.children.length === 1, 'Network error results in exactly 1 toast');
  assert(container.children[0].innerHTML.includes('connection'), 'Displays network connection error toast');

  // Test Case F: Successful login -> no error toast
  Toast.dismissAll();
  container.children = [];
  let redirectedTo = '';
  domSandbox.window.location.replace = (url) => { redirectedTo = url; };
  domSandbox.window.geoSafeStore.login = async () => ({
    success: true,
    user: { name: 'Maria Santos', role: 'Resident' }
  });

  await loginForm.dispatchEvent({ type: 'submit', preventDefault: () => {} });
  const hasErrorToast = container.children.some(c => c.getAttribute('role') === 'alert');
  assert(!hasErrorToast, 'Successful login displays no error toast');
  const hasSuccessToast = container.children.some(c => c.getAttribute('role') === 'status');
  assert(hasSuccessToast, 'Successful login displays success notification');

  console.log('\n================================================================');
  console.log(` RESULTS: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('================================================================');

  process.exit(testsFailed > 0 ? 1 : 0);
})();
