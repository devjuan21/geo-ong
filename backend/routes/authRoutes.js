const express = require('express');
const { body } = require('express-validator');
const { register, login, getSession, logout } = require('../controllers/authController');
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

router.post(['/logout', '/auth/logout'], logout);

module.exports = router;
