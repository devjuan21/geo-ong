const express = require('express');
const { body } = require('express-validator');
const {
  register,
  login,
  getSession,
  logout,
  changePassword,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  verifyRegistrationLocation,
} = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.post(['/verify-location', '/auth/verify-location'], verifyRegistrationLocation);

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
  ['/auth/forgot-password', '/forgot-password'],
  [body('email').isEmail().normalizeEmail().withMessage('Valid email address is required')],
  forgotPassword
);

router.post(
  ['/auth/verify-reset-otp', '/verify-reset-otp'],
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email address is required'),
    body('otp').isString().matches(/^\d{6}$/).withMessage('Valid 6-digit verification code is required'),
  ],
  verifyResetOtp
);

router.post(
  ['/auth/reset-password', '/reset-password'],
  [
    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('New password must be at least 8 characters long'),
    body('confirmPassword')
      .optional()
      .custom((value, { req }) => value === req.body.newPassword)
      .withMessage('New password and confirmation do not match'),
  ],
  resetPassword
);

router.post(['/logout', '/auth/logout'], logout);

module.exports = router;
