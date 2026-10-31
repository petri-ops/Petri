import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const views = require('../core/petri-server/helpers/model3d-views.js');

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');

test('BLOCK-322 P2-04 — 转盘参数：未请求即 null，请求则给默认帧数与俯角', () => {
  for (const absent of [undefined, null, false]) {
    const result = views.normalizeTurntable(absent);
    assert.equal(result.ok, true, JSON.stringify(absent));
    assert.equal(result.turntable, null, `${String(absent)} 应视为未请求（存量行为零变化）`);
  }
  const defaulted = views.normalizeTurntable({});
  assert.deepEqual(defaulted, { ok: true, turntable: { frames: 24, elevationDeg: 20 } });
  const explicit = views.normalizeTurntable({ frames: 8, elevationDeg: -12.5 });
  assert.deepEqual(explicit, { ok: true, turntable: { frames: 8, elevationDeg: -12.5 } });
});

test('BLOCK-322 P2-04 — 越界请求显式拒，不静默夹到边界值', () => {
  const cases = [
    [{ frames: 1 }, 'turntable_frames_invalid'],
    [{ frames: 49 }, 'turntable_frames_invalid'],
    [{ frames: 24.5 }, 'turntable_frames_invalid'],
    [{ frames: '24' }, 'turntable_frames_invalid'],
    [{ elevationDeg: 90 }, 'turntable_elevation_invalid'],
    [{ elevationDeg: -90 }, 'turntable_elevation_invalid'],
    [{ elevationDeg: 'up' }, 'turntable_elevation_invalid'],
    [{ elevationDeg: Infinity }, 'turntable_elevation_invalid'],
    ['turntable', 'turntable_invalid'],
    [[24], 'turntable_invalid'],
  ];
  for (const [raw, code] of cases) {
    const result = views.normalizeTurntable(raw);
    assert.equal(result.ok, false, JSON.stringify(raw));
    assert.match(result.error, new RegExp(code));
  }
  assert.equal(views.normalizeTurntable({ frames: 2, elevationDeg: 89 }).ok, true, '边界值本身合法');
});

test('BLOCK-322 P2-04 — 上下界只声明一处（schema 不抄数字）', () => {
  const toolDefs = read('../core/petri-server/agent-tools/tool-defs/model3d.js');
  const tools = read('../core/petri-server/agent-tools/model3d-tools.js');
  assert.match(toolDefs, /minimum: TURNTABLE_MIN_FRAMES, maximum: TURNTABLE_MAX_FRAMES/);
  assert.doesNotMatch(toolDefs, /frames: \{ type: 'integer', minimum: \d/, 'schema 里出现字面边界就是第二处声明');
  assert.match(tools, /normalizeTurntable\(args\.turntable\)/);
  assert.match(tools, /if \(!requestedTurntable\.ok\) return \{ ok: false, error: requestedTurntable\.error \}/,
    '非法请求要在探 Blender 之前就拒，不占执行成本');
});

test('BLOCK-322 P2-04 — Blender 侧按实测实名跑两遍并按目录发现取产物', () => {
  const python = read('../resources/model3d/blender_scene.py');
  const provider = read('../core/petri-server/helpers/blender-provider.js');
  assert.match(python, /def render_turntable\(out_dir, frames, elevation_deg, bounds\)/);
  assert.match(python, /parser\.add_argument\('--turntable', type=int, default=0\)/);
  assert.match(python, /parser\.add_argument\('--spin-elevation', type=float, default=20\.0\)/);
  assert.match(provider, /if \(turntable\) \{\n {4}args\.push\('--turntable', String\(turntable\.frames\), '--spin-elevation', String\(turntable\.elevationDeg\)\);\n {2}\}/,
    'provider 只透传已校验参数，不自己定边界（边界唯一声明在 model3d-views）');
  assert.doesNotMatch(provider, /Math\.(min|max)\([^)]*frames/i, 'provider 侧夹取边界=第二处判定，会与请求侧漂移');
  assert.match(python, /scene\.render\.ffmpeg\.constant_rate_factor = 'MEDIUM'/,
    '4.5 的实名是 constant_rate_factor；旧名 constant_rate_mode 已不存在（探针实测）');
  assert.doesNotMatch(python, /render\.ffmpeg\.constant_rate_mode\s*=/, '不得回退到旧 API 名（注释里提及旧名做警示是允许的，赋值不行）');
  assert.doesNotMatch(python, /scene\.use_sequencer\s*=|\.editor_type\s*=/, '4.5 无头这两个属性已移除：VSE 路线不成立，本票走「两次渲染」');
  assert.match(python, /scene\.render\.ffmpeg\.audio_codec = 'NONE'/);
  assert.match(python, /def discover_new_files\(out_dir, before\)/);
  assert.match(python, /stills\.append\(still_path\)/, '序列帧名由我们定（可断言），不需要猜 Blender 的动画命名');
  assert.match(python, /movies = \[item for item in discover_new_files\(out_dir, before\)/,
    'mp4 名由 Blender 拼（<stem>0001-00NN.mp4），必须目录发现：猜名字=文件在但登记不到');
  assert.match(python, /scene\.render\.filepath = still_path/);
  assert.match(python, /def _spin_apply\(scene\)/);
  assert.match(python, /bpy\.app\.handlers\.frame_change_pre\.append\(_spin_apply\)/,
    '转盘用 handler 逐帧定角：4.5 的位置/欧拉曲线只给 AUTO/EASE_* 四种插值，设 LINEAR 被 enum 拒（实机抓真），bezier 系又会两头变速');
  assert.doesNotMatch(python, /keyframe_insert|interpolation = 'LINEAR'/, '不得回到关键帧路线');
  assert.match(python, /frame_change_pre\.remove\(_spin_apply\)/, '跑完摘掉 handler，别污染同进程后续步骤');
  assert.match(python, /not turntable\['errors'\]/, '转盘失败必须影响 ok：请求了视频却没视频，静默出图就是欺骗');
  assert.match(python, /'turntable': turntable,/);
  assert.match(python, /requested_frames > 0/, '未请求时零额外渲染成本');
});

test('BLOCK-322 P2-04 — 出片两步解耦：movie 能力缺席不得连坐丢弃已出盘的序列帧', () => {
  const python = read('../resources/model3d/blender_scene.py');
  const provider = read('../core/petri-server/helpers/blender-provider.js');

  // ① 序列帧先记账：mp4 段异常时 stills 必须已经在返回值里（macOS Blender 5.2.3 实测
  //    file_format 拒收 'FFMPEG'，旧实现把整批转盘判失败并丢掉 8 张已出盘的帧）。
  assert.match(python, /stills\.append\(still_path\)/);
  assert.match(python, /'stills': stills,/, 'stills 要在 return 里带回，异常路径才不丢成果');
  assert.match(python, /def render_turntable[\s\S]*?movies = \[\][\s\S]*?try:[\s\S]*?animation=True[\s\S]*?except Exception/,
    'mp4 段要单独兜住：一处可选产物不得拖垮整批产物');

  // ② 能力缺席与执行失败要分流：缺席如实声明（不 ok 翻转），失败仍算错。
  assert.match(python, /movieCapability/, '要声明本平台 movie 输出能力三态');
  assert.match(python, /movie_format_unavailable/, '能力缺席用固定错误码，不是把 bpy_struct 原文当结论');
  assert.match(python, /videoError/, 'mp4 缺席要带原因回显');
  assert.doesNotMatch(python, /and not turntable\.get\('videoError'\)/,
    '能力缺席不得翻转 ok——否则整批产物（含已出盘帧图）被连坐丢弃，且与「执行失败」混为一谈');
  assert.match(python, /and not turntable\['errors'\]/, '真失败（渲染异常等）仍必须影响 ok：静默出图就是欺骗');

  // ③ 缺席态不得伪造产物：video 为 None 时 provider 不能凭空登记 mp4。
  assert.match(provider, /report\.turntable\?\.video \|\| null,/, 'video 缺席时 outputs 里不该出现 mp4');
  assert.match(provider, /const frameAssets = \(report\.turntable\?\.stills \|\| \[\]\)\.map\(describe\)/,
    'frameAssets 逐字节哈希可核：能力缺席平台上这就是唯一的转盘产物面');

  // ④ 三态取值只声明一处（避免 JS/TS/Python 各写一份能力名）。
  const capabilityLiterals = (python.match(/'(available|unavailable|unknown)'/g) || []).length;
  assert.ok(capabilityLiterals <= 4, `能力三态字面量散落 ${capabilityLiterals} 处，应收敛在判定分支内（第二处声明=漂移源）`);
});

test('BLOCK-322 P2-04 — mp4 进成果登记、序列帧只作可核过程产物', () => {
  const provider = read('../core/petri-server/helpers/blender-provider.js');
  assert.match(provider, /report\.turntable\?\.video \|\| null,/);
  assert.match(provider, /const frameAssets = \(report\.turntable\?\.stills \|\| \[\]\)\.map\(describe\)/);
  assert.match(provider, /frameAssets,/, 'frameAssets 单独回传：帧图不进 outputs，否则 24 张近似帧会淹没成果面');
  const projection = read('../core/petri-server/helpers/model3d-artifact-projection.js');
  assert.match(projection, /buildWorkspaceArtifactUrl\(projectId, outputPath\)/, 'mp4 走工作区读面 URL；缺 url 时结果面回落 /api/tools/file 必 404（UI-638 教训）');
  const routes = read('../core/petri-server/routes/model3d.js');
  assert.match(routes, /turntable: req\.body\?\.turntable \?\? null/);
});
