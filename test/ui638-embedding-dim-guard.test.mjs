/**
 * UI-638 加映四 — embedding 维度闸门（红绿先行）。
 *
 * 背景：向量库固定 1024 维（EMBEDDING_DIM），历史向量可能与任一 provider 绑定。
 * 换绑到输出维度不同的模型时，若不校验，余弦相似度会静默算出垃圾分数。
 * 契约：任一批次中出现非 1024 维向量 → 整批拒收（返回 null），并由调用方降级。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { acceptedEmbeddingVectors, EMBEDDING_DIM } = require('../core/petri-server/helpers/embedding-dim-guard.js');

const vec = (dim) => Float32Array.from({ length: dim }, (_, i) => i / dim);

describe('acceptedEmbeddingVectors（1024 维闸门）', () => {
  it('1024 维批次原样通过', () => {
    const input = [vec(1024), vec(1024)];
    assert.equal(acceptedEmbeddingVectors(input), input);
  });

  it('非 1024 维整批拒收（不返回半批）', () => {
    assert.equal(acceptedEmbeddingVectors([vec(768)]), null);
    assert.equal(acceptedEmbeddingVectors([vec(1024), vec(1536)]), null);
    assert.equal(acceptedEmbeddingVectors([vec(0)]), null);
  });

  it('空批次 / 非数组拒收', () => {
    assert.equal(acceptedEmbeddingVectors([]), null);
    assert.equal(acceptedEmbeddingVectors(null), null);
    assert.equal(acceptedEmbeddingVectors(undefined), null);
    assert.equal(acceptedEmbeddingVectors('oops'), null);
  });

  it('常量锚定 1024（换维度必须改常量并重索引）', () => {
    assert.equal(EMBEDDING_DIM, 1024);
  });
});
