const express = require('express');
const { body, param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const {
  createFamilyGroup,
  getMyFamily,
  generateInvitation,
  validateInvitation,
  submitJoinRequest,
  getPendingJoinRequests,
  reviewJoinRequest,
  removeFamilyMember,
  revokeInvitation,
  toggleLocationSharing,
  updateLocationCoordinates,
  getFamilyLocations,
  leaveFamilyGroup,
  updateFamilyAddress,
} = require('../controllers/familyController');

const router = express.Router();

// All family management endpoints require an authenticated user session
router.use(authenticate);

// 1. Validate invitation token
router.get(
  ['/invitations/validate/:token', '/validate-invite/:token'],
  [param('token').trim().isLength({ min: 16, max: 128 })],
  validateInvitation
);

// 2.1 Family Group Info & Retrieval
router.get(['/', '/my-family'], getMyFamily);

// 2.2 Family Group Creation (Requires family_name, house_number, and street; fixed Barangay Bayanan location enforced)
router.post(
  ['/', '/groups'],
  [
    body('family_name').trim().isLength({ min: 2, max: 120 }).withMessage('Family name must be between 2 and 120 characters'),
    body('house_number').isString().trim().isLength({ min: 1, max: 50 }).withMessage('House / Building number is required (max 50 characters)'),
    body('street').isString().trim().isLength({ min: 1, max: 150 }).withMessage('Street name is required (max 150 characters)'),
    body('relationship').optional().trim().isLength({ max: 60 }),
  ],
  createFamilyGroup
);

// 2.3 QR Invitation Generation & Revocation (Manager only)
router.post(
  '/invitations',
  [body('expires_in_hours').optional().isInt({ min: 1, max: 168 })],
  generateInvitation
);

router.delete('/invitations/:id', revokeInvitation);

// 2.4 Join Requests Workflow
router.post(
  '/join-requests',
  [
    body('invitation_token').trim().isLength({ min: 16, max: 128 }).withMessage('Valid invitation token is required'),
    body('relationship').optional().trim().isLength({ max: 60 }),
  ],
  submitJoinRequest
);

router.get('/join-requests', getPendingJoinRequests);

router.put(
  '/join-requests/:id/review',
  [
    param('id').isInt({ min: 1 }),
    body('action').isIn(['approve', 'reject']).withMessage('Action must be approve or reject'),
  ],
  reviewJoinRequest
);

// 2.5 Member Management
router.delete('/members/:memberId', removeFamilyMember);
router.post('/leave', leaveFamilyGroup);

// 2.6 Location Sharing & Privacy Controls
router.put(
  '/location-sharing',
  [
    body('enabled').isBoolean().withMessage('Sharing status must be boolean'),
    body('agreed_to_policy').optional().isBoolean(),
  ],
  toggleLocationSharing
);

router.post(
  '/location-update',
  [
    body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required'),
    body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required'),
    body('battery_level').optional().isInt({ min: 0, max: 100 }),
    body('safety_status').optional().isIn(['safe', 'need_help', 'injured', 'no_response']),
  ],
  updateLocationCoordinates
);

router.get('/locations', getFamilyLocations);

// 2.7 Family Shared Address (House / Building Number and Street Name only; fixed location enforced on backend)
router.put(
  '/address',
  [
    body('street').isString().trim().isLength({ min: 1, max: 150 }).withMessage('Street name is required (max 150 characters)'),
    body('house_number').isString().trim().isLength({ min: 1, max: 50 }).withMessage('House / Building number is required (max 50 characters)'),
  ],
  updateFamilyAddress
);

module.exports = router;
