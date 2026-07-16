/**
 * Desktop Express middleware bootstrap.
 *
 * The server is loopback-only and has one local administrator identity. Web
 * login, JWT, API-token and internal-node authentication are intentionally not
 * part of the desktop runtime.
 */

const cors = require('cors');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { LOCAL_USER, setupAuthRoutes } = require('./auth');

function requestIdMiddleware(req, res, next) {
  const rid = req.headers['x-request-id'] || uuidv4().slice(0, 12);
  req.requestId = rid;
  res.setHeader('X-Request-Id', rid);
  next();
}

function localIdentityMiddleware(req, _res, next) {
  req.user = LOCAL_USER;
  next();
}

function setupBootstrap(app, { db }) {
  app.use(cors());
  app.use(express.json({ limit: '200mb' }));
  app.use(requestIdMiddleware);

  setupAuthRoutes(app, db);
  app.use(localIdentityMiddleware);

  try {
    const { moduleGate } = require('./helpers/permissions');
    app.use(moduleGate);
  } catch (error) {
    console.warn('[modules] permission gate failed to load:', error && error.message);
  }
}

module.exports = {
  requestIdMiddleware,
  localIdentityMiddleware,
  setupBootstrap,
};
