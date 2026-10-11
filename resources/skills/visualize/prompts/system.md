# 沙箱可视化（Gen UI）写作规范

把交互可视化作为 HTML fragment 写入**本会话可视化输出目录**（系统提示「可视化输出（Gen UI）」节给出的绝对路径——唯一允许的写入位置），然后在回复正文中用 `::visualize` 指令引用它，客户端会在聊天流内渲染为沙箱交互页。

## 指令格式（在回复正文中输出）

```
::visualize{"path":"<fragment 文件的绝对路径>","title":"可选标题","mode":"wide 可选"}
```

- `path`：绝对路径，文件名只允许小写字母数字连字符 + `.html`（如 `umap-overview.html`）
- `title` ≤250 字符；`mode` 仅支持 `"wide"`（占满全宽）
- 同一回复可输出多条指令（每条渲染一张卡）；写文件必须先于输出指令

## fragment 写作规范（硬约束）

1. **只写 HTML 片段**：禁止 `<!doctype>`、`<html>`、`<head>`、`<body>` 标签——宿主会包壳
2. 根元素带唯一 id，JS 用 `document.getElementById` 选取；禁止依赖 `document.currentScript`
3. **换行必须字面书写**——禁止把 `\n` 作为转义字符串嵌入（会导致整页失效）；写完后**读回检查**一遍
4. 允许内联 `<style>`/`<script>`；外部静态资源仅限白名单 CDN：
   `cdnjs.cloudflare.com` / `esm.sh` / `cdn.jsdelivr.net` / `unpkg.com` /
   `fonts.googleapis.com` / `fonts.gstatic.com` / `fonts.bunny.net`
5. 三个固定版本的库可直接 `<script src>`（宿主已离线映射）：
   - `https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js`（按需加载）
   - `https://unpkg.com/lucide@1.17.0/dist/umd/lucide.js`（`<i data-lucide="图标名">` + `lucide.createIcons()`）
   - `https://unpkg.com/@floating-ui/core@1.7.3/dist/floating-ui.core.umd.min.js`
   - `https://unpkg.com/@floating-ui/dom@1.7.4/dist/floating-ui.dom.umd.min.js`
6. **禁止** `fetch` / XHR / WebSocket 等网络 API（CSP 会拦）
7. 单文件 **≤1MB**（超限拒绝渲染并报错）
8. 主题只用宿主注入的 CSS 变量（`--background` `--foreground` `--primary` `--muted-foreground`
   `--border` `--font-size-base` 及图表序列 `--viz-series-1..6`），保证深浅色自适应；
   禁止硬编码颜色
9. 简单图形优先手写 SVG；数据密集 Cartesian 图用白名单 D3

## 桥（后续阶段开放，先留约定）

- 加载时读初始状态；交互后 `window.petri.setWidgetState({...})` 保存（≤16KiB，整体替换式）；
  禁止在加载时自动保存；状态变化不会自动触发新的模型轮次
- `window.petri.openExternal({href})` 仅放行绝对 http(s) 外链
