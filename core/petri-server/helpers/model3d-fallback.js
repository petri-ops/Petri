'use strict';

/**
 * item84：3D 供应商不可用/未配置时的三选一询问（owner 拍板交互）。
 * 触发由 agent 调既有 ask_user_question 工具完成，这里只提供单一问题真值；
 * 前端独立弹窗按 questionId 前缀识别，不侵入会话卡片区。
 */

const QUESTION_ID_PREFIX = 'model3d-fallback';

function buildModel3DFallbackQuestion() {
  return {
    questionId: QUESTION_ID_PREFIX,
    question: '3D 生成失败：可本地近似生成、先配置凭据重试或取消？',
    options: [
      {
        id: 'model3d-fallback-continue',
        label: '本地近似生成',
        description: '几何体组合近似；产物如实标注「本地近似非 AI 生成」',
      },
      {
        id: 'model3d-fallback-configure',
        label: '先配置凭据重试',
        description: '检查 Ark 模型开通/配置后再重试 AI 3D',
      },
      {
        id: 'model3d-fallback-cancel',
        label: '取消',
        description: '本次不做 3D',
      },
    ],
    multiSelect: false,
    allowFreeText: false,
  };
}

module.exports = { QUESTION_ID_PREFIX, buildModel3DFallbackQuestion };
