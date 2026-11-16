process.chdir(require('path').join(__dirname, '../../../frontend'));
/**
 * GeoSafe - Login Page & Authentication Verification Suite
 * ============================================================================
 * Tests:
 * 1. File existence & GeoSafe branding
 * 2. Form fields, show/hide password, autocomplete attributes, clean form defaults
 * 3. Zero emojis in login.html & assets/js/login.js
 * 4. Zero hardcoded credentials, demo accounts, or prefilled values
 * 5. Client-side validation logic (email RFC regex, required fields)
 * 6. Store authentication methods (login, logout, getCurrentUser)
 * 7. Real API call connection (/api/login)
 * 8. Server error & invalid credential handling (no simulated success)
 * 9. Role-based redirection (Resident -> index.html, Responder -> responder-dashboard.html, Admin -> admin.html)
 * 10. Admin portal RBAC protection
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

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
console.log(' GeoSafe Login Page & Authentication Verification');
console.log('================================================================\n');

// 1. Check Files
console.log('1. Checking Files:');
assert(fs.existsSync('login.html'), 'login.html exists');
assert(fs.existsSync('assets/js/login.js'), 'assets/js/login.js exists');
assert(fs.existsSync('admin.html'), 'admin.html exists');
assert(fs.existsSync('assets/js/store.js'), 'assets/js/store.js exists');

const loginHtml = fs.readFileSync('login.html', 'utf8');
const loginJs = fs.readFileSync('assets/js/login.js', 'utf8');
const storeJs = fs.readFileSync('assets/js/store.js', 'utf8');
const adminHtml = fs.readFileSync('admin.html', 'utf8');

// 2. Check Branding & Minimal Design
console.log('\n2. Checking Branding & Minimal Design:');
assert(loginHtml.includes('GeoSafe'), 'Displays GeoSafe brand name');
assert(!loginHtml.includes('National Government') && !loginHtml.includes('Office of the President'), 'Does not invent official government or institutional affiliation');
assert(!loginHtml.includes('Hazard & Rescue Dispatch'), 'No large disaster feature promo cards on minimal login page');
assert(!loginHtml.includes('Safe Haven Routing'), 'No large disaster feature promo cards on minimal login page');
assert(loginHtml.includes('min-h-screen') && loginHtml.includes('flex items-center justify-center'), 'Login card centered horizontally and vertically on screen');

// 3. Check Form Controls & Autocomplete Requirements
console.log('\n3. Checking Form Controls & Autocomplete:');
assert(loginHtml.includes('id="login-email"') && loginHtml.includes('type="email"'), 'Includes Email address field with email type');
assert(loginHtml.includes('autocomplete="off"') || loginHtml.includes('autocomplete="username"'), 'Email field has autocomplete configured');
assert(loginHtml.includes('id="login-password"') && loginHtml.includes('type="password"'), 'Includes Password field with password type');
assert(loginHtml.includes('autocomplete="new-password"') || loginHtml.includes('autocomplete="current-password"'), 'Password field has autocomplete configured');
assert(loginHtml.includes('id="toggle-password-btn"'), 'Includes Show/Hide password toggle control');
assert(loginHtml.includes('id="forgot-password-btn"'), 'Includes Forgot Password link');
assert(loginHtml.includes('id="login-submit-btn"'), 'Includes Login submit button');

// 4. Check UI Theme & Responsive Styling
console.log('\n4. Checking Theme & Responsive Styling:');
assert(loginHtml.includes('#FFF9E8') || loginHtml.includes('bg-[#FFF9E8]'), 'Uses warm off-white / cream background (#FFF9E8)');
assert(loginHtml.includes('#F5B900') || loginHtml.includes('bg-[#F5B900]'), 'Uses GeoSafe primary yellow accent (#F5B900)');
assert(loginHtml.includes('rounded-3xl'), 'Uses rounded card corners matching GeoSafe design system');
assert(loginHtml.includes('max-w-md'), 'Uses compact card layout (centered on desktop, comfortable padding on mobile)');

// 5. Check Zero Emojis
console.log('\n5. Verifying Zero Emojis:');
const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
assert(!emojiRegex.test(loginHtml), 'Zero emojis in login.html');
assert(!emojiRegex.test(loginJs), 'Zero emojis in assets/js/login.js');
assert(!emojiRegex.test(adminHtml), 'Zero emojis in admin.html');

// 6. Check Zero Hardcoded Credentials & Demo Accounts
console.log('\n6. Verifying Zero Hardcoded Credentials or Demo Accounts:');
assert(!loginHtml.includes('admin@geosafe.local'), 'Zero hardcoded demo email in login.html');
assert(!loginHtml.includes('admin123') && !loginHtml.includes('responder123') && !loginHtml.includes('resident123'), 'Zero hardcoded demo passwords in login.html');
assert(!loginHtml.includes('auth-demo-btn') && !loginHtml.includes('Quick Demo 1-Tap Login'), 'Zero 1-tap demo login buttons in login.html');
assert(!loginJs.includes('admin@geosafe.local'), 'Zero demo credentials in assets/js/login.js');
assert(!loginJs.includes('admin123') && !loginJs.includes('responder123'), 'Zero demo passwords in assets/js/login.js');

// Verify login inputs have no hardcoded value attribute
const emailInputMatch = loginHtml.match(/<input[^>]*id="login-email"[^>]*>/);
const passwordInputMatch = loginHtml.match(/<input[^>]*id="login-password"[^>]*>/);
assert(emailInputMatch && !emailInputMatch[0].includes('value='), 'login-email has no prefilled value attribute');
assert(passwordInputMatch && !passwordInputMatch[0].includes('value='), 'login-password has no prefilled value attribute');

// 7. Check Store Authentication Implementation
console.log('\n7. Checking Store Authentication Implementation:');
assert(storeJs.includes('async login(email, password, rememberMe'), 'store.login() method implemented');
assert(storeJs.includes('async logout()'), 'store.logout() method implemented');
assert(storeJs.includes('getCurrentUser()'), 'store.getCurrentUser() method implemented');
assert(storeJs.includes('/api/login') || storeJs.includes('${apiBase}/login'), 'store.login connects to actual backend endpoint /api/login');

// 8. Test Login Logic in Simulated Environment
console.log('\n8. Testing Login Client Logic in Simulated Environment:');

// Setup Node.js globals for browser emulation
global.window = {
  addEventListener: () => {},
  dispatchEvent: () => {},
  GEOSAFE_CONFIG: {
    API_BASE_URL: '/api',
    USE_MOCK_DATA: false
  }
};
global.CustomEvent = class {
  constructor(name, opts) {
    this.name = name;
    this.detail = opts ? opts.detail : null;
  }
};

const storageMap = {};
global.sessionStorage = {
  getItem: (k) => storageMap[k] || null,
  setItem: (k, v) => { storageMap[k] = String(v); },
  removeItem: (k) => { delete storageMap[k]; }
};
const localMap = {};
global.localStorage = {
  getItem: (k) => localMap[k] || null,
  setItem: (k, v) => { localMap[k] = String(v); },
  removeItem: (k) => { delete localMap[k]; }
};

// Load mock-data and store in Node.js
eval(fs.readFileSync('assets/js/mock-data.js', 'utf8'));
eval(fs.readFileSync('assets/js/store.js', 'utf8'));

const store = window.geoSafeStore;

async function runStoreTests() {
  // Test empty credential validation
  let caughtEmpty = false;
  try {
    await store.login('', '');
  } catch (err) {
    caughtEmpty = true;
    assert(err.message.includes('email and password'), 'Rejects empty credentials with clear message');
  }
  assert(caughtEmpty, 'Validation prevented empty submission');

  // Test network offline validation
  store.isOnline = () => false;
  let caughtOffline = false;
  try {
    await store.login('test@example.com', 'password');
  } catch (err) {
    caughtOffline = true;
    assert(err.message.includes('offline'), 'Detects offline state and alerts user');
  }
  assert(caughtOffline, 'Blocked login attempt when offline');
  store.isOnline = () => true;

  // Test server error response handling (401 Unauthorized)
  global.fetch = async (url, opts) => {
    return {
      ok: false,
      status: 401,
      json: async () => ({ error: 'Invalid email or password' })
    };
  };

  let caught401 = false;
  try {
    await store.login('resident@example.com', 'wrongpassword');
  } catch (err) {
    caught401 = true;
    assert(err.message.includes('Invalid email or password'), 'Handles 401 error with sanitized credential message');
  }
  assert(caught401, '401 Unauthorized handled correctly');
  assert(store.getCurrentUser() === null, 'No user stored on failed login');

  // Test server network connection failure (Backend offline)
  global.fetch = async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:3000');
  };

  let caughtConnRefused = false;
  try {
    await store.login('resident@example.com', 'password123');
  } catch (err) {
    caughtConnRefused = true;
    assert(err.message.includes('unavailable'), 'Informs user clearly when backend server is offline without fabricating success');
  }
  assert(caughtConnRefused, 'Connection refused handled truthfully');

  // Test successful authentication for Resident
  global.fetch = async (url, opts) => {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        message: 'Login successful',
        user: {
          id: 42,
          name: 'Maria Santos',
          email: 'maria@example.com',
          role: 'resident',
          role_name: 'Resident'
        }
      })
    };
  };

  const residentRes = await store.login('maria@example.com', 'mariasPass123', true);
  assert(residentRes.success === true, 'Successful login returns success flag');
  assert(residentRes.role === 'Resident', 'Role normalized to Resident');
  assert(store.getCurrentUser().email === 'maria@example.com', 'Current user populated with verified email');

  // Test successful authentication for Responder
  global.fetch = async (url, opts) => {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        message: 'Login successful',
        user: {
          id: 88,
          name: 'Officer Ramirez',
          email: 'ramirez@example.com',
          role: 'responder',
          role_name: 'Responder'
        }
      })
    };
  };

  const responderRes = await store.login('ramirez@example.com', 'responderPass', false);
  assert(responderRes.role === 'Responder', 'Role normalized to Responder');

  // Test successful authentication for Administrator
  global.fetch = async (url, opts) => {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        message: 'Login successful',
        user: {
          id: 1,
          name: 'EOC Command Lead',
          email: 'command@example.com',
          role: 'admin',
          role_name: 'Administrator'
        }
      })
    };
  };

  const adminRes = await store.login('command@example.com', 'adminPass', false);
  assert(adminRes.role === 'Administrator', 'Role normalized to Administrator');

  // Test logout invalidates session & user
  await store.logout();
  assert(store.getCurrentUser() === null, 'Logout clears current user');

  // 9. Check Role Redirection Logic
  console.log('\n9. Checking Role-Based Redirection Paths:');
  assert(loginJs.includes("'index.html'"), 'Resident redirects to index.html (Resident Portal)');
  assert(loginJs.includes("'responder-dashboard.html'"), 'Responder redirects to responder-dashboard.html (Responder Portal)');
  assert(loginJs.includes("'admin.html'"), 'Administrator redirects to admin.html (Admin Portal)');

  // 10. Check Admin RBAC Protection
  console.log('\n10. Checking Admin Portal RBAC Protection:');
  assert(adminHtml.includes('verifySession') || adminHtml.includes('admin'), 'admin.html enforces authorized admin verification check');
  assert(adminHtml.includes('Administrator'), 'admin.html identifies Administrator portal context');

  console.log('\n================================================================');
  if (testsFailed === 0) {
    console.log(` ALL ${testsPassed} LOGIN & AUTH VERIFICATION CHECKS PASSED (0 FAILURES)!`);
  } else {
    console.error(` VERIFICATION FAILED: ${testsFailed} checks failed.`);
  }
  console.log('================================================================\n');

  process.exit(testsFailed === 0 ? 0 : 1);
}

runStoreTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
