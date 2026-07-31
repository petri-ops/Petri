'use strict';

const crypto = require('crypto');

const RUNTIME_LEASE = Object.freeze({
  instanceId: crypto.randomBytes(16).toString('hex'),
  startedAt: new Date().toISOString(),
  ownerPid: process.pid,
});

function getResultStudioRuntimeLease() {
  return RUNTIME_LEASE;
}

function isResultStudioRuntimeLease(value) {
  return !!value
    && /^[a-f0-9]{32}$/.test(String(value.instanceId || ''))
    && Number.isFinite(Date.parse(value.startedAt || ''))
    && (value.ownerPid == null || (Number.isInteger(value.ownerPid) && value.ownerPid > 0));
}

function isResultStudioRuntimeLeaseOwnerAlive(value, signal = process.kill) {
  if (!isResultStudioRuntimeLease(value) || !Number.isInteger(value.ownerPid)) return null;
  try {
    signal(value.ownerPid, 0);
    return true;
  } catch (error) {
    return error?.code === 'ESRCH' ? false : true;
  }
}

module.exports = {
  getResultStudioRuntimeLease,
  isResultStudioRuntimeLease,
  isResultStudioRuntimeLeaseOwnerAlive,
};
