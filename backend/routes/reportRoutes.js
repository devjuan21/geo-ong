const express = require('express');
const { body } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { getBayananBounds } = require('../utils/bayananBoundary');
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

  // Fallback to verified Barangay Bayanan polygon center if missing or invalid
  const bayananBounds = getBayananBounds();
  if (req.body.latitude === undefined || req.body.latitude === null || isNaN(Number(req.body.latitude))) {
    req.body.latitude = bayananBounds.centerLat;
  } else {
    req.body.latitude = Number(req.body.latitude);
  }
  if (req.body.longitude === undefined || req.body.longitude === null || isNaN(Number(req.body.longitude))) {
    req.body.longitude = bayananBounds.centerLng;
  } else {
    req.body.longitude = Number(req.body.longitude);
  }

  // Normalize single photo into photos array
  if (!Array.isArray(req.body.photos) && typeof req.body.photo === 'string' && req.body.photo.trim()) {
    req.body.photos = [req.body.photo.trim()];
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
  requireRole('resident', 'admin'),
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

const statusUpdateMiddleware = [
  requireRole('admin', 'responder'),
  [
    body('status').optional().isIn(['pending', 'verified', 'dispatched', 'responding', 'on_site', 'in_progress', 'resolved', 'false_alarm', 'dismissed']),
    body('severity').optional().isIn(['low', 'medium', 'high', 'critical']),
    body('assigned_to').optional().isInt({ min: 1 }),
  ],
  updateReportStatus,
];

router.put('/:id/status', ...statusUpdateMiddleware);
router.patch('/:id/status', ...statusUpdateMiddleware);

module.exports = router;
