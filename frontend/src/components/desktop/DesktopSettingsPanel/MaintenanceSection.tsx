import { UpdateChecker } from './sections/UpdateChecker';
import { ExportDiagnostic } from './sections/ExportDiagnostic';
import { ConfigTransferPanel } from './sections/ConfigTransferPanel';

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
        <h3>隐私与维护</h3>
        <p>控制匿名错误反馈，并处理诊断和应用更新。</p>
      </div>
      {/* M2-3：可选错误遥测开关（默认关闭，用户主动开启） */}
      <div className="petri-field">
        <label className="petri-field__label">开启错误反馈</label>
        <div className="petri-toggle-row">
          <input
            type="checkbox"
            id="petri-telemetry-toggle"
            className="petri-toggle"
            checked={telemetryEnabled}
            onChange={(event) => onToggleTelemetry(event.target.checked)}
          />
          <label htmlFor="petri-telemetry-toggle" className="petri-toggle-label">
            {telemetryEnabled ? '已开启' : '已关闭'}
          </label>
        </div>
        <p className="petri-field__hint">
          开启后，分析出错时仅上报错误分类与应用版本（不含任何用户数据、文件路径或文件名），
          用于改进工具稳定性。可随时关闭。
        </p>
      </div>
      <div className="petri-maintenance-actions">
        <div className="petri-maintenance-row">
          <div>
            <strong>应用更新</strong>
            <p>检查并下载适用于当前 Mac 的安装包。</p>
          </div>
          <UpdateChecker />
        </div>
        <div className="petri-maintenance-row">
          <div>
            <strong>诊断日志</strong>
            <p>导出用于排查问题的本地诊断信息。</p>
          </div>
          <ExportDiagnostic />
        </div>
      </div>
      {/* BLOCK-201 W2 — 设置全景导出/导入（注册表 6 族；凭据与未注册落点显式排除） */}
      <ConfigTransferPanel onChanged={onConfigChanged} />
    </section>
  );
}
