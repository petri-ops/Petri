/**
 * POST-S7 H2/B-08 —— 静默 catch 棘轮门自带负测。
 *
 * 口径必须被钉住，否则门会「变绿」得毫无意义：
 *   - 裸 `catch {}` / `catch { }` 计入债务
 *   - 带注释的 `catch { /* … *\/ }` **不计入**（有留痕的忽略不是债务）
 *   - `catch (e) { throw e }` 之类的处理形态不计入
 *   - 仓内基线自洽（总数 = 基线总数，任何文件不得超基线）
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { countBareCatches } from '../scripts/silent-catch-ratchet.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

test('裸 catch 计入债务；带注释与已处理形态不计入', () => {
  assert.equal(countBareCatches('try { a(); } catch {}'), 1);
  assert.equal(countBareCatches('try { a(); } catch { }'), 1);
  assert.equal(countBareCatches('try { a(); } catch {\n  }'), 1, '跨行空体也算');
  assert.equal(countBareCatches('try { a(); } catch { /* cleanup best-effort */ }'), 0, '带注释=已留痕');
  assert.equal(countBareCatches('try { a(); } catch (e) { throw e; }'), 0);
  assert.equal(countBareCatches('try { a(); } catch (e) { console.warn(e); }'), 0);
  assert.equal(countBareCatches('try { a(); } catch {}\ntry { b(); } catch {}'), 2);
});

test('仓内门禁当前为 PASS（基线自洽、无新增）', () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'silent-catch-ratchet.mjs'), '--check'], { encoding: 'utf8' });
  assert.match(out, /PASS/);
});
