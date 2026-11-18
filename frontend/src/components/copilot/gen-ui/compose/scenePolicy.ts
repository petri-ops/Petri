/**
 * frontend/src/components/copilot/gen-ui/compose/scenePolicy.ts
 *
 * BLOCK-463 [W11 双形态互达] 三面选择判定契约（纯函数）：同一个 ::compose spec
 * 的呈现面选择——数据组件走受控渲染（inline-render），3D 产物（mesh-reference .glb）
 * 走 Result Studio 工作面（open-workbench，沿 UI-654 model3dOpen 先例）。
 * 沙箱（::visualize）/compose（::compose）/model3d viewer 三面并存非替代
 *（gen-ui 评估 §8 边界），本函数只钉 compose 内部的呈现分派。
 */

export type ComposePresentation = 'inline-render' | 'open-workbench';

export interface ComposePresentationNode {
  kind: string;
  source?: { path?: string; sourceSha256?: string };
}

/** .glb 后缀判定（mesh 产物；格式白名单细节由 meshAssets 单源承索）。 */
function isGlbPath(path: unknown): boolean {
  return typeof path === 'string' && path.toLowerCase().endsWith('.glb');
}

/** 判定矩阵：mesh-reference + .glb → 工作面；其余一律受控渲染。 */
export function selectComposePresentation(node: ComposePresentationNode): ComposePresentation {
  if (node.kind === 'mesh-reference' && isGlbPath(node.source?.path)) return 'open-workbench';
  return 'inline-render';
}

/** scene.json 配对路径（model3d/runs 惯例：GLB 同目录 scene.json，沿 UI-654 sceneSnapshotFromUrl）。 */
export function sceneJsonSiblingFor(glbPath: string): string {
  const normalized = String(glbPath || '').replace(/\\/g, '/');
  const dir = normalized.slice(0, normalized.lastIndexOf('/'));
  return `${dir}/scene.json`;
}
