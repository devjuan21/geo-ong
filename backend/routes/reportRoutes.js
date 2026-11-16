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

function normalizeReportPayload(req, res, next) {
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

  const rawLat = req.body.latitude;
  const rawLng = req.body.longitude;
  if (rawLat === undefined || rawLat === null || rawLat === '' || rawLng === undefined || rawLng === null || rawLng === '') {
    return res.status(400).json({ error: 'Valid latitude and longitude coordinates are required.' });
  }

  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180 || (lat === 0 && lng === 0)) {
    return res.status(400).json({ error: 'Valid latitude and longitude coordinates are required.' });
  }
  req.body.latitude = lat;
  req.body.longitude = lng;

  // Normalize single photo into photos array
  if (!Array.isArray(req.body.photos) && typeof req.body.photo === 'string' && req.body.photo.trim()) {
    req.body.photos = [req.body.photo.trim()];
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
    body('assigned_to').optional().isInt({ min: 1 }),
  ],
  updateReportStatus,
];

router.put('/:id/status', ...statusUpdateMiddleware);
router.patch('/:id/status', ...statusUpdateMiddleware);

module.exports = router;
