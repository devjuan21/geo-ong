const express = require('express');
const { body, param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const {
  getUsers,
  createUser,
  updateUserStatus,
  deactivateUserAccount,
} = require('../controllers/userController');

const router = express.Router();

// Every route in this file is Administrator-only, enforced server-side.
router.use(authenticate, requireRole('admin'));

router.get('/', getUsers);

router.post(
  '/',
  [
    body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name required (2-100 chars)'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('role_id').exists().withMessage('role_id is required'),
  ],
  createUser
);

// Account deactivation / suspension / reactivation (preserves historical records)
router.patch(
  '/:id/status',
  [
    param('id').isInt({ min: 1 }),
    body('status').isIn(['active', 'inactive', 'suspended']).withMessage('status must be active, inactive, or suspended'),
    body('reason').optional().isString().trim().isLength({ max: 255 }),
  ],
  updateUserStatus
);

router.put(
  '/:id/status',
  [
    param('id').isInt({ min: 1 }),
    body('status').isIn(['active', 'inactive', 'suspended']).withMessage('status must be active, inactive, or suspended'),
    body('reason').optional().isString().trim().isLength({ max: 255 }),
  ],
  updateUserStatus
);

// DELETE soft-deactivates the user account rather than physically deleting historical records
router.delete(
  '/:id',
  [param('id').isInt({ min: 1 })],
  deactivateUserAccount
);

module.exports = router;
