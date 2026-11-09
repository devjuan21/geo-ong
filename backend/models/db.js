/**
 * MySQL Connection Pool Adapter
 * Re-exports the canonical pool from ../config/db so existing imports
 * using require('../models/db') or require('./models/db') share the same pool.
 */
module.exports = require('../config/db');
