/**
 * Shim — canonical implementation now lives in shared-backend/logger.js.
 * Kept so existing `require('./logger')` consumers inside py-server keep
 * working during the Phase 4 migration.
 */
module.exports = require('../shared-backend/logger');
