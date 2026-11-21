const express = require('express');
const { body } = require('express-validator');
const {
  getAdminOverview,
  getAdminStats,
  getVulnerableResidents,
  getAdminReportsList,
  getAdminReportDetail,
  reviewAdminReport,
  closeAdminIncident,
  getAdminUsers,
  createResponderAccount,
  createResidentAccount,
  updateAdminUserStatus,
  reviewResidentLocationVerification,
  getAdminAuditLogs,
  getAdminRespondersList,
  getAdminLiveResponderLocations,
  getAdminResponderRecommendations,
  assignResponder,
  getEmergencyBroadcasts,
  createEmergencyBroadcast,
  cancelEmergencyBroadcast,
  getBroadcastCategories,
  createBroadcastCategory,
  getAdminAnalytics,
  getMonthlyIncidentsByCategory,
  exportAdminAnalyticsCsv,
  getAdminSystemSettings,
  updateAdminSystemSetting,
  getAdminFacilities,
  createAdminFacility,
  updateAdminFacility,
} = require('../controllers/adminController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const {
  previewAdminExport,
  generateAdminExport,
} = require('../controllers/adminExportController');

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
router.post('/reports/incident/:id/close', closeAdminIncident);

// 3. Responder Management & Dispatch
router.get('/responders', getAdminRespondersList);
router.get('/responders/live-locations', getAdminLiveResponderLocations);
router.get('/responders/recommendations', getAdminResponderRecommendations);
router.post('/responders/assign', assignResponder);

// 4. Users Management (Residents & Responders)
router.get('/users', getAdminUsers);
router.post(
  '/users/responders',
  (req, _res, next) => {
    // Support both camelCase and snake_case request bodies seamlessly
    if (req.body) {
      if (req.body.firstName && !req.body.first_name) req.body.first_name = req.body.firstName;
      if (req.body.middleName && !req.body.middle_name) req.body.middle_name = req.body.middleName;
      if (req.body.surname && !req.body.last_name) req.body.last_name = req.body.surname;
      if (req.body.lastName && !req.body.last_name) req.body.last_name = req.body.lastName;
      if (req.body.contactNumber && !req.body.contact_number) req.body.contact_number = req.body.contactNumber;
      if (req.body.phone && !req.body.contact_number) req.body.contact_number = req.body.phone;
      if (req.body.phone_number && !req.body.contact_number) req.body.contact_number = req.body.phone_number;
      if (req.body.serviceId && !req.body.service_id) req.body.service_id = req.body.serviceId;
      if (req.body.organizationId && !req.body.service_id) req.body.service_id = req.body.organizationId;
      if (req.body.badgeNumber && !req.body.service_id) req.body.service_id = req.body.badgeNumber;
      if (req.body.customDesignation && (!req.body.designation || req.body.designation === 'Other')) {
        req.body.designation = req.body.customDesignation;
      }
      if (req.body.custom_designation && (!req.body.designation || req.body.designation === 'Other')) {
        req.body.designation = req.body.custom_designation;
      }
      if (!req.body.organization) {
        req.body.organization = 'Barangay Bayanan Emergency Response Team';
      }
      if (req.body.status && !req.body.account_status) req.body.account_status = req.body.status;
    }
    next();
  },
  [
    body('first_name').trim().notEmpty().withMessage('First name is required'),
    body('last_name').trim().notEmpty().withMessage('Last name is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email address is required'),
    body('contact_number').trim().notEmpty().withMessage('Contact number is required'),
    body('organization').trim().notEmpty().withMessage('Organization is required'),
    body('designation').trim().notEmpty().withMessage('Designation is required'),
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
router.post('/users/:id/location-verification', reviewResidentLocationVerification);

// 5. Alerts & Notifications (Emergency Broadcasts & Categories)
router.get('/broadcast-categories', getBroadcastCategories);
router.post(
  '/broadcast-categories',
  [
    body('name').trim().notEmpty().isLength({ max: 60 }).withMessage('Category name is required (max 60 chars)'),
  ],
  createBroadcastCategory
);
router.get('/broadcasts', getEmergencyBroadcasts);
router.post(
  '/broadcasts',
  [
    body('title').trim().notEmpty().withMessage('Broadcast title is required'),
    body('message').trim().notEmpty().withMessage('Broadcast message is required'),
    body('category_id')
      .custom((val, { req }) => {
        const hasId = val !== undefined && val !== null && String(val).trim() !== '';
        const hasName = Boolean((req.body && (req.body.advisory_type || req.body.advisoryType || req.body.category)));
        return hasId || hasName;
      })
      .withMessage('Advisory category is required'),
  ],
  createEmergencyBroadcast
);
router.patch('/broadcasts/:id/cancel', cancelEmergencyBroadcast);

// 6. Reports & Analytics
router.get('/analytics', getAdminAnalytics);
router.get('/analytics/monthly-categories', getMonthlyIncidentsByCategory);
router.post('/analytics/export/preview', previewAdminExport);
router.post('/analytics/export', generateAdminExport);
router.get('/analytics/export', generateAdminExport);

// 7. System Settings & Maintenance
router.get('/settings', getAdminSystemSettings);
router.patch('/settings/:key', updateAdminSystemSetting);
router.post('/settings', updateAdminSystemSetting);

// 8. Read-Only Audit Logs
router.get('/audit-logs', getAdminAuditLogs);

// 9. Healthcare Facility Directory Management
router.get('/facilities', getAdminFacilities);
router.post('/facilities', createAdminFacility);
router.patch('/facilities/:id', updateAdminFacility);

module.exports = router;
