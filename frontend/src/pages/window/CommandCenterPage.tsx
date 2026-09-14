// ============================================================
// CommandCenterPage — BLOCK-59 P3 指挥中心墙（/window/command-center）。
//
// 单例无状态窗（随开随关，plan §4.1）：网格瓦片聚合**全部项目**最近作业的
// 实时状态。瓦片墙核心已提取为 [CommandCenterJobsWall](./CommandCenterJobsWall.tsx)
// （UI-362）：同一组件以 projectId=null（全局俯瞰）与 projectId=当前项目
// （右栏「指挥中心」tab，项目绑定俯瞰）两个宿主复用，数据真相唯一
// （只读 /api/tools/history，5s 轮询，零本地任务状态缓存）。
//
// BLOCK-64 指挥中心 UX（P1-a/P1-b/P2-d）行为随瓦片墙保留：活跃置顶 /
// 项目归属标注 / 远程徽章 / 查日志 / 两步取消 / done·failed 下钻。
// ============================================================
import React, { useState } from 'react';
import { WindowShell } from '@/components/window/WindowShell';
import { CommandCenterJobsWall } from './CommandCenterJobsWall';

export function CommandCenterPage(): React.ReactElement {
  const [stats, setStats] = useState({ active: 0, history: 0 });

  return (
    <WindowShell
      title="指挥中心"
      badge="多任务俯瞰 · 只读投影"
      closeBehavior="close"
      subtitle={`活跃 ${stats.active} · 历史 ${stats.history} · 5s 刷新`}
    >
      <CommandCenterJobsWall
        projectId={null}
        emptyText={
          <>
            暂无作业记录——在任意项目里运行一个分析后，瓦片会出现在这里。
            <br />
            快捷键 <strong>Ctrl/Cmd+Shift+C</strong> 随时打开指挥中心。
          </>
        }
        onStatsChange={setStats}
      />
    </WindowShell>
  );
}
