-- BLOCK-99 G3 — 会话级知识空间绑定（D1 裁决：单会话绑单空间）
-- additive：新表；space_id FK ON DELETE CASCADE —— 绑定的空间被删时绑定行
-- 自动消失，该会话回落默认空间（ks_default 不可删，兜底恒在）。
-- 绑定到 ks_default 时不落行（helpers 层约定），避免无谓行膨胀。

CREATE TABLE IF NOT EXISTS knowledge_space_bindings (
  conversation_id TEXT PRIMARY KEY,
  space_id        TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY (space_id) REFERENCES knowledge_spaces(id) ON DELETE CASCADE
);
