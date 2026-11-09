const express = require('express');
const { body } = require('express-validator');
const {
  getAdminOverview,
  getAdminStats,
  getVulnerableResidents,
  getAdminReportsList,
  getAdminReportDetail,
  reviewAdminReport,
  getAdminUsers,
  createResponderAccount,
  createResidentAccount,
  updateAdminUserStatus,
  getAdminAuditLogs,
  getAdminRespondersList,
  assignResponder,
  getEmergencyBroadcasts,
  createEmergencyBroadcast,
  getAdminAnalytics,
  exportAdminAnalyticsCsv,
  getAdminSystemSettings,
  updateAdminSystemSetting,
} = require('../controllers/adminController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

const router = express.Router();

// Strictly enforce authenticated Administrator role on all /api/admin/* endpoints
router.use(authenticate, requireRole('admin'));

// 1. Dashboard Overview & Map
router.get('/overview', getAdminOverview);
router.get('/stats', getAdminStats);
router.get('/vulnerable', getVulnerableResidents);

// 2. Incident Reports & Rescue Requests Verification
router.get('/reports', getAdminReportsList);
router.get('/reports/:type/:id', getAdminReportDetail);
router.patch('/reports/:type/:id/review', reviewAdminReport);

// 3. Responder Management & Dispatch
router.get('/responders', getAdminRespondersList);
router.post('/responders/assign', assignResponder);

// 4. Users Management (Residents & Responders)
router.get('/users', getAdminUsers);
router.post(
  '/users/responders',
  (req, _res, next) => {
    // Support both camelCase and snake_case request bodies seamlessly
    if (req.body) {
      if (req.body.firstName && !req.body.first_name) req.body.first_name = req.body.firstName;
      if (req.body.surname && !req.body.last_name) req.body.last_name = req.body.surname;
      if (req.body.lastName && !req.body.last_name) req.body.last_name = req.body.lastName;
      if (req.body.badgeNumber && !req.body.badge_number) req.body.badge_number = req.body.badgeNumber;
      if (req.body.assignedUnit && !req.body.assigned_unit) req.body.assigned_unit = req.body.assignedUnit;
      if (req.body.phone && !req.body.phone_number) req.body.phone_number = req.body.phone;
    }
    next();
  },
  [
    body('first_name').trim().notEmpty().withMessage('First name is required'),
    body('last_name').trim().notEmpty().withMessage('Surname is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email address is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters long'),
    body('badge_number').trim().notEmpty().withMessage('Badge number is required'),
    body('assigned_unit').trim().notEmpty().withMessage('Assigned unit is required'),
  ],
  createResponderAccount
);
router.post(
  '/users/residents',
  (req, _res, next) => {
    if (req.body) {
      if (req.body.firstName && !req.body.first_name) req.body.first_name = req.body.firstName;
      if (req.body.surname && !req.body.last_name) req.body.last_name = req.body.surname;
      if (req.body.lastName && !req.body.last_name) req.body.last_name = req.body.lastName;
      if (req.body.phone && !req.body.phone_number) req.body.phone_number = req.body.phone;
    }
    next();
  },
  [
    body('first_name').trim().notEmpty().withMessage('First name is required'),
    body('last_name').trim().notEmpty().withMessage('Last name is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email address is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters long'),
  ],
  createResidentAccount
);
router.patch('/users/:id/status', updateAdminUserStatus);

// 5. Alerts & Notifications (Emergency Broadcasts)
router.get('/broadcasts', getEmergencyBroadcasts);
router.post(
  '/broadcasts',
  [
    body('title').trim().notEmpty().withMessage('Broadcast title is required'),
    body('message').trim().notEmpty().withMessage('Broadcast message is required'),
    body('severity').isIn(['Advisory', 'Watch', 'Warning', 'Critical Evacuation']).withMessage('Invalid broadcast severity'),
  ],
  createEmergencyBroadcast
);

// 6. Reports & Analytics
router.get('/analytics', getAdminAnalytics);
router.get('/analytics/export', exportAdminAnalyticsCsv);

// 7. System Settings & Maintenance
router.get('/settings', getAdminSystemSettings);
router.patch('/settings/:key', updateAdminSystemSetting);
router.post('/settings', updateAdminSystemSetting);

// 8. Read-Only Audit Logs
router.get('/audit-logs', getAdminAuditLogs);

module.exports = router;
