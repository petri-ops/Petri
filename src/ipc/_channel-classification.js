'use strict';

// src/ipc/_channel-classification.js — L2-6（蓝图 L-09）/ L2-5（L-04/07/08）：
// 通道分类注记（独立文件——channels.js 默认导出形状被 30+ 消费方与 preload 双向守卫
// 依赖，不得混入非字面量键）。testOnly/platformScoped/note 语义见块内注释。
// L2-6（蓝图 L-09）/ L2-5（L-04/07/08）：通道分类注记——不改 CHANNELS 字面量形状
//（preload 双向守卫依赖逐字节字面量），分类单列于此并由
// test/ipc-channels-registry.test.mjs 校验「注记键 ⊆ 注册表」。
//   testOnly = 验收/flow 专用通道（产品 UI 零消费）；
//   platformScoped = 仅特定平台/打包态可用；
//   note = 消费现状留痕（零消费通道的销号/降级注记）。
const CHANNEL_CLASSIFICATION = {
  'app:preview-quit-summary': { testOnly: true, note: 'L-09：验收/flow 专用（quit summary 预览），产品 UI 零消费' },
  'diagnostic:crash-simulate': { testOnly: true, note: 'L-09：验收专用崩溃演练' },
  'startup:marks': { testOnly: true, note: 'L-07：验收/flow 专用（CDP evalJs 消费），产品渲染层零调用（源码自注「无业务消费方」）' },
  'updater:check': { platformScoped: 'darwin+packaged', note: 'L-04：非 darwin/打包态恒 disabled，前端更新入口按平台隐藏待 L6' },
  'updater:download': { platformScoped: 'darwin+packaged', note: 'L-04 同上' },
  'updater:download-progress': { platformScoped: 'darwin+packaged', note: 'L-04 同上' },
  'updater:error': { platformScoped: 'darwin+packaged', note: 'L-04 同上' },
  'updater:install': { platformScoped: 'darwin+packaged', note: 'L-04 同上' },
  'updater:update-available': { platformScoped: 'darwin+packaged', note: 'L-04 同上（非 darwin 永不触发）' },
  'updater:update-downloaded': { platformScoped: 'darwin+packaged', note: 'L-04 同上' },
  'updater:update-not-available': { platformScoped: 'darwin+packaged', note: 'L-04 同上' },
  'content-plugin:list': { note: 'L-08：渲染层仅类型声明无调用（预留通道，失败形状已带 degraded 信封）' },
  'content-plugin:list-docs': { note: 'L-08 同上' },
  'content-plugin:read': { note: 'L-08 同上' },
  'telemetry:report': { note: 'L-08：渲染层无调用（预留）' },
};


module.exports = { CHANNEL_CLASSIFICATION };
