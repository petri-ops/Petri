'use strict';

/**
 * BLOCK-88 P1 工程师声明身份（D1-A 轻量声明身份）。
 *
 * 配对握手 additive identity：访客工程师自带 displayName/device 标注，存被访端
 * gateway 会话（sessions.json）与本端 peers 注册表；对端仅展示、不建账号体系
 * （auth.js 单管理员设计零触碰）。信任模型 = 配对 token + 熟人网络，面板须诚实
 * 标注「声明身份，未经验证」（plan §6 风险 1）。
 *
 * 展示字段不信任输入方：剥离控制字符 + 截断封顶；三处消费方共用本定义，
 * 避免各写一份截断/净化规则漂移（gateway 配对 / peers 注册表 / 契约测试）。
 */

const FIELD_MAX = 40;

function cleanField(value) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, FIELD_MAX)
    : '';
}

/**
 * 任意输入 → 安全身份对象；无有效字段返回 null（调用方据此不落 identity 键，
 * 存量无身份会话/节点的投影键集保持不变）。
 */
function sanitizeEngineerIdentity(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const displayName = cleanField(raw.displayName);
  const device = cleanField(raw.device);
  if (!displayName && !device) return null;
  const identity = {};
  if (displayName) identity.displayName = displayName;
  if (device) identity.device = device;
  return identity;
}

module.exports = { sanitizeEngineerIdentity, FIELD_MAX };
