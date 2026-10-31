import React from 'react';
import { Model3DScene } from '@/components/work-surface/Model3DScene';
import { getApiPrefix } from '@/lib/env';

/**
 * BLOCK-322 产品洞察 — 聊天内嵌 3D 预览卡。
 *
 * 产品原则（用户洞察 2026-10-30）：聊天时间线是一等交互面——agent 产出的富内容
 * 应在聊天内直接可交互。model3d_export 工具完成后，本组件在聊天时间线内渲染
 * 可旋转的 3D 预览（复用 Model3DScene，不建第二渲染器）。
 */

export interface ChatTool3DPreviewProps {
  projectId: string;
  /** 预留：后续按 jobId 拉工具状态/产物列表 */
  jobId?: string;
  /** GLB 的 workspace 相对路径（从工具结果 outputs 提取）。 */
  glbPath: string;
}

export function ChatTool3DPreview({ projectId, glbPath }: ChatTool3DPreviewProps): React.ReactElement {
  const url = `${getApiPrefix()}/files/${encodeURIComponent(projectId)}/${glbPath.split('/').map(encodeURIComponent).join('/')}`;
  return (
    <div data-testid="chat-tool-3d-preview" style={{ margin: '4px 0', border: '1px solid rgba(128,152,177,0.3)', borderRadius: 6, overflow: 'hidden' }}>
      <div style={{ height: 200 }}>
        <Model3DScene view={null} viewAngle='iso' modelUrl={url} modelFormat='glb' />
      </div>
    </div>
  );
}

export default ChatTool3DPreview;
