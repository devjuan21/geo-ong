/**
 * GeoSafe — Toast Notification Verification Suite
 * Verifies all 14 requirements for the login toast notification component.
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
assert(loginHtml.includes('assets/js/toast.js'), 'login.html includes assets/js/toast.js');
assert(loginHtml.indexOf('assets/js/toast.js') < loginHtml.indexOf('assets/js/login.js'), 'toast.js is loaded before login.js');

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
assert(toastJs.includes('bg-[#FFF1F1]') && toastJs.includes('border-[#FFC2C2]'), 'Includes GeoSafe red error styling');
assert(toastJs.includes('#D93636'), 'Uses GeoSafe emergency red accent (#D93636) for error icon');
assert(toastJs.includes('rounded-2xl'), 'Uses GeoSafe rounded-2xl corner radius');
assert(toastJs.includes('role') && toastJs.includes('alert') && toastJs.includes('aria-live'), 'Includes accessibility attributes role="alert" and aria-live');
assert(toastJs.includes('aria-label="Close notification"'), 'Includes accessible dismiss button');
assert(toastJs.includes('activeToasts') && toastJs.includes('normalizedKey'), 'Prevents multiple identical toasts from stacking (deduplication)');
assert(toastJs.includes('duration = typeof options.duration === \'number\' ? options.duration : 3500') || toastJs.includes('3500'), 'Default auto-dismiss duration set to ~3.5 seconds');
assert(toastJs.includes('Escape'), 'Supports ESC key dismissal');

// 3. Inspect login.js
console.log('\n3. Checking assets/js/login.js integration:');
const loginJsPath = path.join(__dirname, '../../../frontend/assets/js/login.js');
const loginJs = fs.readFileSync(loginJsPath, 'utf8');

assert(loginJs.includes('Invalid email or password.'), 'Displays normalized message "Invalid email or password."');
assert(loginJs.includes('showToastNotification') || loginJs.includes('GeoSafeToast'), 'Calls toast notification on login failure');
assert(!loginJs.includes('login-error-banner.classList.remove'), 'No inline error banner toggle in login.js');

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
  }

  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k]; }
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
}

const mockDocument = {
  elementsById: new Map(),
  body: new MockElement('BODY'),
  createElement(tag) {
    return new MockElement(tag);
  },
  getElementById(id) {
    if (id === 'geosafe-toast-container') {
      return this.elementsById.get(id) || null;
    }
    return null;
  }
};

const domSandbox = {
  window: {
    addEventListener: () => {},
    removeEventListener: () => {}
  },
  document: mockDocument,
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

console.log('\n================================================================');
console.log(` RESULTS: ${testsPassed} passed, ${testsFailed} failed`);
console.log('================================================================');

process.exit(testsFailed > 0 ? 1 : 0);
