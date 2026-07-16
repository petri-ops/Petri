/**
 * Shim — canonical implementation now lives in shared-backend/error-log.js.
 * Kept so existing `require('../helpers/error-log')` / `require('./helpers/error-log')`
 * consumers keep working during the Phase 4 migration.
 */
module.exports = require('../../shared-backend/error-log');
