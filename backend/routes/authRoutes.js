const express = require('express');
const { body } = require('express-validator');
const {
  register,
  login,
  getSession,
  logout,
  changePassword,
} = require('../controllers/authController');
const {
  submitPasswordAssistanceTicket,
} = require('../controllers/passwordAssistanceController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.post(
  ['/register', '/auth/register'],
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email address is required'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long'),
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 120 })
      .withMessage('Name must be between 2 and 120 characters'),
    body('first_name')
      .optional()
      .trim()
      .isLength({ min: 1, max: 80 })
      .withMessage('First name must be between 1 and 80 characters'),
    body('last_name')
      .optional()
      .trim()
      .isLength({ min: 1, max: 80 })
      .withMessage('Last name must be between 1 and 80 characters'),
  ],
  register
);

router.post(
  ['/login', '/auth/login'],
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email address is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  login
);

router.get(['/auth/session', '/me', '/auth/me'], authenticate, getSession);

router.post(
  ['/auth/change-password', '/change-password'],
  authenticate,
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('New password must be at least 8 characters long'),
    body('confirmPassword')
      .optional()
      .custom((value, { req }) => value === req.body.newPassword)
      .withMessage('New password and confirmation do not match'),
  ],
  changePassword
);

router.post(
  ['/auth/password-assistance', '/password-assistance'],
  [
    body('fullName').optional().trim().isLength({ min: 2, max: 120 }),
    body('email').isEmail().normalizeEmail().withMessage('Valid email address is required'),
    body('mobileNumber').trim().matches(/^[0-9+\-\s()]{7,30}$/).withMessage('Valid mobile number is required'),
    body('accountRole').isIn(['resident', 'responder']).withMessage('Account role must be Resident or Responder'),
    body('description').trim().isLength({ min: 10, max: 1000 }).withMessage('Description must be between 10 and 1000 characters'),
  ],
  submitPasswordAssistanceTicket
);

router.post(['/logout', '/auth/logout'], logout);

module.exports = router;
