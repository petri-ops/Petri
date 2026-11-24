/**
 * BLOCK-511 S2.3 — petri-pack-bio 兄弟仓 pack.json 的可移植解析。
 *
 * 四个 P6 测试此前写死 `/Users/zhangdiandian/...` 个人绝对路径，换机必红。
 * 统一改走 PETRI_PACK_BIO_ROOT（缺省=仓库同级 petri-pack-bio）；
 * 路径不存在时返回 null，由调用方显式 t.skip 并写明原因（不用 try/catch 掩盖）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function packBioRoot() {
  return process.env.PETRI_PACK_BIO_ROOT
    ? path.resolve(process.env.PETRI_PACK_BIO_ROOT)
    : path.resolve(ROOT, '..', 'petri-pack-bio');
}

export function packBioPackPath() {
  return path.join(packBioRoot(), 'pack.json');
}

/** 返回 pack.json 文本；不存在返回 null（调用方显式 skip）。 */
export function readPackBioJson() {
  const file = packBioPackPath();
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}

export const PACK_BIO_SKIP_REASON =
  'petri-pack-bio 兄弟仓未配置（设 PETRI_PACK_BIO_ROOT=<path> 启用 P6 pack 声明断言）';
