import { SettingsField } from './SettingsField';
import { UpdateChecker } from './sections/UpdateChecker';
import { ExportDiagnostic } from './sections/ExportDiagnostic';
import { ConfigTransferPanel } from './sections/ConfigTransferPanel';
import { LessonEvidencePanel } from './sections/LessonEvidencePanel';

/**
 * MaintenanceSection — 「隐私与维护」分区（BLOCK-201 W2 从 696→750 行面板抽出）。
 *
 * 抽出的唯一触发是 code-size 门禁（面板基线 696 / 预算 700）：本包新增搜索与备份面后
 * 顶爆预算，按「已超健康体量的文件先拆再加」纪律把这一整节（反馈/更新/诊断/配置备份）
 * 搬成独立组件，而不是申请例外或抬基线。
 */
interface Props {
  telemetryEnabled: boolean;
  onToggleTelemetry: (next: boolean) => void;
  /** 配置导入成功后通知父层重挂载分区面板。 */
  onConfigChanged: () => void;
}

export function MaintenanceSection({ telemetryEnabled, onToggleTelemetry, onConfigChanged }: Props): React.ReactElement {
  return (
    <section className="petri-settings-section">
      <div className="petri-settings-section__heading">
        <h3>数据与维护</h3>
        <p>数据目录、备份、诊断与反馈；更新会在界面上主动提示，不用进这里找。</p>
      </div>
      {/* M2-3：可选错误遥测开关（默认关闭，用户主动开启） */}
      <SettingsField
        icon="shield"
        label="错误反馈"
        htmlFor="petri-telemetry-toggle"
        trailing
        meta={telemetryEnabled ? '已开启' : '已关闭'}
        hint="仅上报错误分类与应用版本，不含用户数据、文件路径或文件名"
      >
        <input
          type="checkbox"
          id="petri-telemetry-toggle"
          className="petri-toggle"
          checked={telemetryEnabled}
          onChange={(event) => onToggleTelemetry(event.target.checked)}
        />
      </SettingsField>
      {/* L6-6（蓝图 L-72/BLOCK-410）：本地主权说明——产品人设「跑在你机器上」的设置面可见形态 */}
      <p className="petri-field__hint" role="note" data-testid="local-sovereignty-note">
        本机优先：数据、模型凭据与产物均保存在本机，核心链路本地运行、全程可审计。
      </p>
      <SettingsField icon="download" label="诊断日志" trailing hint="导出本地诊断信息用于排查问题">
        <ExportDiagnostic />
      </SettingsField>
      {/* EVO-4 UI-716 — harness 自进化证据（只读快照，零写入控件）。
          偏好预审「文字少」：说明收敛到面板内一行，字段不再重复 hint；
          不用 trailing：panel 内容宽度可变，trailing 会把 label 列挤成竖排。 */}
      <SettingsField icon="bar-chart" label="Harness 自进化证据">
        <LessonEvidencePanel />
      </SettingsField>
      {/* BLOCK-201 W2 — 设置全景导出/导入（注册表 6 族；凭据与未注册落点显式排除） */}
      <ConfigTransferPanel onChanged={onConfigChanged} />
      {/* UI-704 — 更新检查移出主位（用户裁决「设置内部不实用」）：页面内 UpdateCard
          主动呈现；此处保留折叠的手动检查入口（功能不删，搜索可达）。 */}
      <details className="petri-settings-advanced-details">
        <summary>手动检查更新（通常不需要——新版本会自动在页面上出现）</summary>
        <SettingsField icon="refresh" label="应用更新" trailing hint="检查并下载当前系统的安装包">
          <UpdateChecker />
        </SettingsField>
      </details>
    </section>
  );
}
