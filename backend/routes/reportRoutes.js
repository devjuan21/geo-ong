const express = require('express');
const { body } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const {
  createReport,
  getReports,
  getReportById,
  updateReportStatus,
} = require('../controllers/reportController');

const router = express.Router();

router.use(authenticate);

function normalizeReportPayload(req, _res, next) {
  if (!req.body) req.body = {};

  // Normalize incident_type / incidentType
  if (!req.body.incident_type && req.body.incidentType) {
    req.body.incident_type = req.body.incidentType;
  }
  if (!req.body.incidentType && req.body.incident_type) {
    req.body.incidentType = req.body.incident_type;
  }

  // Normalize title
  if (!req.body.title && req.body.incident_type) {
    req.body.title = `${req.body.incident_type} Incident`;
  }

  // Normalize address / location
  if (!req.body.address && req.body.location) {
    req.body.address = req.body.location;
  }
  if (!req.body.location && req.body.address) {
    req.body.location = req.body.address;
  }

  // Normalize coordinates: { lat, lng } -> latitude, longitude
  if (req.body.coordinates && typeof req.body.coordinates === 'object') {
    if (req.body.latitude === undefined && req.body.coordinates.lat !== undefined) {
      req.body.latitude = req.body.coordinates.lat;
    }
    if (req.body.longitude === undefined && req.body.coordinates.lng !== undefined) {
      req.body.longitude = req.body.coordinates.lng;
    }
  }

  // Normalize lat / lng -> latitude, longitude
  if (req.body.latitude === undefined && req.body.lat !== undefined) {
    req.body.latitude = req.body.lat;
  }
  if (req.body.longitude === undefined && req.body.lng !== undefined) {
    req.body.longitude = req.body.lng;
  }

  // Fallback to Barangay Bayanan center coordinates if missing or invalid
  if (req.body.latitude === undefined || req.body.latitude === null || isNaN(Number(req.body.latitude))) {
    req.body.latitude = 14.4081;
  } else {
    req.body.latitude = Number(req.body.latitude);
  }
  if (req.body.longitude === undefined || req.body.longitude === null || isNaN(Number(req.body.longitude))) {
    req.body.longitude = 121.0415;
  } else {
    req.body.longitude = Number(req.body.longitude);
  }

  // Normalize severity
  if (req.body.severity) {
    const s = String(req.body.severity).toLowerCase();
    if (s === 'moderate') req.body.severity = 'medium';
    else if (['low', 'medium', 'high', 'critical'].includes(s)) req.body.severity = s;
  }

  next();
}

router.post(
  '/',
  requireRole('resident'),
  normalizeReportPayload,
  [
    body('incident_type').trim().isLength({ min: 2, max: 100 }).withMessage('Incident type is required (2-100 characters).'),
    body('description').trim().isLength({ min: 5, max: 2000 }).withMessage('Description must be between 5 and 2000 characters.'),
    body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required.'),
    body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required.'),
  ],
  createReport
);

router.get('/', getReports);

router.get('/:id(\\d+)', getReportById);

router.put(
  '/:id/status',
  requireRole('admin', 'responder'),
  [
    body('status').optional().isIn(['pending', 'verified', 'responding', 'on_site', 'resolved', 'dismissed']),
    body('severity').optional().isIn(['low', 'medium', 'high', 'critical']),
    body('assigned_to').optional().isInt({ min: 1 }),
  ],
  updateReportStatus
);

module.exports = router;
