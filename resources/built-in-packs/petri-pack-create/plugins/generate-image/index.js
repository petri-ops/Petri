/**
 * generate.image — P0 Seedream provider adapter（provider 细节留在本包，内核零硬编码）。
 *
 * 创作宪法（owner msg_a9c7bc882f84）：
 *  - 多候选并排：count>1 → N 候选（各自落盘+sha256），Result Studio 并排对比；
 *  - 指向式迭代：referenceImagePath → 真图内容 base64 走 image-to-image（agent 执行，人不手改）；
 *  - 规格自证：source 含 prompt/model/seed/provenance（可复现可审计）。
 * 凭据：env ARK_API_KEY 或 credentialRef（ark:seedream）；不落明文、不写日志。
 * 产物：写本地文件 + sha256 实算（artifact-truth 同款算法，包自治不 require 主仓 core）。
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const API_BASE = process.env.ARK_API_BASE || 'https://ark.cn-beijing.volces.com/api/v3';
const DEFAULT_MODEL = process.env.ARK_SEEDREAM_MODEL || 'doubao-seedream-4-0-260415';

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function resolveApiKey() {
  if (process.env.ARK_API_KEY) return process.env.ARK_API_KEY;
  // credentialRef 形态 'ark:seedream'：由宿主注入 PETRI_CREDENTIAL_ARK_SEEDREAM（不读明文文件）
  return process.env.PETRI_CREDENTIAL_ARK_SEEDREAM || null;
}

async function generateImage(input = {}, deps = {}) {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt) throw new Error('prompt_required');
  const apiKey = deps.apiKey || resolveApiKey();
  if (!apiKey) throw new Error('ark_credential_missing');

  const params = input.params && typeof input.params === 'object' ? { ...input.params } : {};
  const count = Math.max(1, Math.min(4, Number(input.count) || 1));
  const seed = params.seed != null ? params.seed : null;

  // 指向式迭代：参考图读真内容 base64 → image-to-image（不是只传 artifact id）
  let referenceImage = null;
  if (input.referenceImagePath && typeof input.referenceImagePath === 'string') {
    referenceImage = fs.readFileSync(input.referenceImagePath).toString('base64');
  }

  const fetchImpl = deps.fetch || globalThis.fetch;
  const resp = await fetchImpl(`${API_BASE}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: deps.model || DEFAULT_MODEL,
      prompt,
      n: count,
      ...params,
      ...(referenceImage ? { image: referenceImage } : {}),
      ...(input.referenceArtifactId ? { reference_image: input.referenceArtifactId } : {}),
      response_format: 'b64_json',
    }),
  });
  if (!resp.ok) throw new Error(`seedream_http_${resp.status}`);
  const payload = await resp.json();
  const items = Array.isArray(payload?.data) ? payload.data.filter((it) => it && it.b64_json) : [];
  if (!items.length) throw new Error('seedream_empty_output');

  const outDir = deps.outDir || path.join(process.cwd(), 'create-output');
  fs.mkdirSync(outDir, { recursive: true });
  const descriptors = items.map((item, index) => {
    const fileName = `image-${Date.now()}-${index + 1}.png`;
    const filePath = path.join(outDir, fileName);
    fs.writeFileSync(filePath, Buffer.from(item.b64_json, 'base64'));
    return {
      path: filePath,
      sha256: sha256File(filePath),
      mime: 'image/png',
      source: {
        provider: 'seedream',
        model: deps.model || DEFAULT_MODEL,
        prompt,
        seed,
        reference: input.referenceImagePath || input.referenceArtifactId || null,
      },
    };
  });

  // 单候选保持既有单描述符形态（向后兼容）；多候选返回数组供 Result Studio 并排。
  return count === 1 && descriptors.length === 1 ? descriptors[0] : descriptors;
}

module.exports = { generateImage, sha256File, resolveApiKey };
