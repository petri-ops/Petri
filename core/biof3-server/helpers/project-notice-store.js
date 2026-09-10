'use strict';

/**
 * helpers/project-notice-store.js — BLOCK-78 P2-⑤ 项目通知 store 单例。
 *
 * 惰性建 store（首个消费者触发 ensureTable），模块级缓存；路由与
 * tools-executor 写点经同一单例访问，避免第二份连接/建表竞态。
 */

const { createProjectNoticeStore } = require('./project-notices');

let store = null;

function getProjectNoticeStore() {
  if (!store) {
    const db = require('../db');
    store = createProjectNoticeStore(db.getDatabase());
  }
  return store;
}

module.exports = { getProjectNoticeStore };
