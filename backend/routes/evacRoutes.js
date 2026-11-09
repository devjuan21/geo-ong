const express = require('express');
const {
  getEvacuationCenters,
  getEvacuationCenterById,
  updateEvacuationCenter
} = require('../controllers/evacController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

const router = express.Router();

// All evacuation center routes require authentication
router.use(authenticate);

router.get('/', getEvacuationCenters);
router.get('/:id', getEvacuationCenterById);

// Updating evacuation center requires admin or responder role
router.put('/:id', requireRole('admin', 'responder'), updateEvacuationCenter);

module.exports = router;
