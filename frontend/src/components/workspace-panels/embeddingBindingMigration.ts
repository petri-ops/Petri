/**
 * 试用反馈迭代② — 向量模型配置从「模型接口」迁到「知识空间」设置区。
 *
 * 只改配置 UI 归属：读写同一 `model_role_bindings.embedding` 与派生的
 * `embed_provider`，其它 settings 字段逐字保留（embedding 底层链零变化、
 * BLOCK-518 语义不回退、老用户配置不丢）。
 */
export interface EmbeddingBindingSettings {
  model_role_bindings?: Record<string, string>;
  embed_provider?: string;
  [key: string]: unknown;
}

/**
 * 把新的向量绑定写入 settings 快照：仅替换 embedding 绑定与派生 embed_provider。
 * 老配置（既有 embedding 绑定）通过读取 settings 原样呈现，迁移零丢失。
 */
export function applyEmbeddingBinding(
  settings: EmbeddingBindingSettings,
  binding: string,
  embedProvider?: string,
): EmbeddingBindingSettings {
  return {
    ...settings,
    model_role_bindings: { ...(settings.model_role_bindings || {}), embedding: binding },
    ...(embedProvider !== undefined ? { embed_provider: embedProvider } : {}),
  };
}

/** 从 settings 读取当前向量绑定（老配置兼容：缺失返回空串）。 */
export function readEmbeddingBinding(settings: EmbeddingBindingSettings | null | undefined): string {
  return settings?.model_role_bindings?.embedding || '';
}
