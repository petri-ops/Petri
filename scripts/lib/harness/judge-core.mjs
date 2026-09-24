/**
 * BLOCK-119 — 输出评判门内核 ESM 薄壳。
 * 单源在 core/biof3-server/helpers/judge-core.js（canonical CJS；P2 产品侧与 dev CLI/校准
 * 同形同源，防形状漂移即校准失效——block115 单源纪律）。
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../../../core/biof3-server/helpers/judge-core.js');

export const FIT_RUBRIC = core.FIT_RUBRIC;
export const buildJudgeRequest = core.buildJudgeRequest;
export const parseDimensionStatuses = core.parseDimensionStatuses;
export const aggregateVerdict = core.aggregateVerdict;
export const retryHints = core.retryHints;
export const median = core.median;
export const fitNearThreshold = core.fitNearThreshold;
export const judgeOutput = core.judgeOutput;
