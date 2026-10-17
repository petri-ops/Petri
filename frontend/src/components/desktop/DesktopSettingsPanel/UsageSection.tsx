import { UsageResourcePanel } from './sections/UsageResourcePanel';
import { UsageCostPanel } from './sections/UsageCostPanel';
import { DecisionUsagePanel } from './sections/DecisionUsagePanel';

/**
 * UsageSection — 「用量与资源」分区（BLOCK-202 W3 从面板抽出）。
 *
 * 抽出的触发与 BLOCK-201 的 MaintenanceSection 同源：面板贴着 code-size 棘轮基线，
 * 新增网络/审批两节后必须等量下沉既有整节才能保持"只减不增"。
 * `versionKey` 由父层在重置/导入后递增，用于让成本面板重新拉取生效值。
 */
interface Props {
  versionKey: number;
}

export function UsageSection({ versionKey }: Props): React.ReactElement {
  return (
    <section className="petri-settings-section">
      <div className="petri-settings-section__heading">
        <h3>用量与资源</h3>
        <p>查看模型成本、缓存命中和当前机器容量，不保存原始数据或密钥。</p>
      </div>
      <UsageResourcePanel />
      {/* BLOCK-163 W3 P9（MDL-4）— 按模型成本/用量面板（usage-mine models 聚合） */}
      <UsageCostPanel key={`usage-cost-${versionKey}`} />
      {/* BLOCK-116 W2 — 决策原语观测面（decision_log 聚合，additive） */}
      <DecisionUsagePanel />
    </section>
  );
}
