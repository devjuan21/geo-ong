const express = require('express');
const { body } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { createAlert, getAlerts } = require('../controllers/alertController');

const router = express.Router();

router.use(authenticate);

router.post(
  '/',
  requireRole('admin'),
  (req, _res, next) => {
    if (req.body && !req.body.severity && req.body.level) {
      req.body.severity = req.body.level;
    }
    next();
  },
  [
    body('message').trim().isLength({ min: 5, max: 1000 }),
    body('severity')
      .optional({ values: 'falsy' })
      .isIn([
        'Critical',
        'High',
        'Moderate',
        'Medium',
        'Low',
        'critical',
        'high',
        'moderate',
        'medium',
        'low',
        'Advisory',
        'Watch',
        'Warning',
        'Critical Evacuation',
      ]),
  ],
  createAlert
);

router.get('/', getAlerts);

module.exports = router;
