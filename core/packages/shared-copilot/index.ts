/**
 * @biof3/shared — web 版（Docusaurus）与桌面版（Vite SPA）共享的 Copilot 纯逻辑层。
 *
 * 渲染层组件（CopilotChat / copilotClient / ActResultCard / ActionCard）因依赖
 * 各自前端的 getApiPrefix / 离线降级 / Docusaurus 运行时，仍各自维护。
 * 本包只收敛无框架依赖的纯逻辑/类型/数据，消除"镜像同步双写"痛点。
 *
 * 用法（两边都 alias `@biof3/shared` → 本目录）：
 *   import { UIMessage, THREAD_KEY } from '@biof3/shared';
 *   import { errMsg } from '@biof3/shared/error';
 */

export * from './types';
export * from './context';
export * from './trace';
export * from './helpers';
export * from './actions';
export * from './actionBus';
export { errMsg } from './error';
