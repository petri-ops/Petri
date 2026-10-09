/**
 * BLOCK-154 波次 1 — highlight.js 子路径类型补齐。
 *
 * highlight.js@11.11 官方 types 已声明 'highlight.js' 与 'highlight.js/lib/languages/*'，
 * 唯独缺 'highlight.js/lib/core'（package exports map 该子路径也只有 require/import
 * 条目、无 types）。core 的默认导出与根包同型（HLJSApi），按官方形态补一条，
 * 避免 bundler 解析（frontend/tsconfig.json moduleResolution=bundler）下隐式 any。
 */
declare module 'highlight.js/lib/core' {
  import hljs from 'highlight.js';
  export default hljs;
}
