'use strict';

/**
 * embedding 维度常量与闸门（UI-638 加映四）。
 *
 * 向量库固定 1024 维（历史向量与 provider 绑定解耦的前提）。换绑到输出维度
 * 不同的模型时，必须整批拒收（返回 null → 调用方降级），否则余弦相似度会
 * 静默算出垃圾分数。独立成无依赖模块，便于单测与复用。
 */

const EMBEDDING_DIM = 1024;

function acceptedEmbeddingVectors(vectors) {
  if (!Array.isArray(vectors) || vectors.length === 0) return null;
  for (const vector of vectors) {
    if (!vector || typeof vector.length !== 'number' || vector.length !== EMBEDDING_DIM) {
      try {
        console.warn(
          `[embedding-dim-guard] embedding dim mismatch: got ${vector && vector.length}, expected ${EMBEDDING_DIM}; batch rejected (fail-open)`,
        );
      } catch { /* 日志失败不反噬 */ }
      return null;
    }
  }
  return vectors;
}

module.exports = { EMBEDDING_DIM, acceptedEmbeddingVectors };
