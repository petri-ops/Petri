// ============================================================
// hunkControls — BLOCK-28 主区审阅模式 hunk 悬浮 accept/reject 控件
//
// 以 git hunk 为语义基准（与 useWorkingTreeReview.decisions 的
// `file#hunkIndex` 决策键一致）：在每个 hunk 首行行尾嵌入行内控件。
// 不使用 merge view 内建 mergeControls（它编辑编辑器文档而非磁盘，
// 与 WTR 决策模型冲突）。
//
// 用法：createHunkControlsExtension({ getInfo }) 注入 CodeMirrorEditor
// 的 extraExtensions；getInfo 返回最新 hunk 控件信息（React 侧每次
// 渲染重建 extension，经 extraCompartment 热替换）。
// ============================================================

import { RangeSetBuilder, type Extension } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
} from '@codemirror/view';

export interface HunkControlInfo {
  /** git hunk 序号（决策键 `path#index`）。 */
  hunkIndex: number;
  /** hunk 在新文件（=modified doc）中的 1-based 行号。 */
  line: number;
  /** 当前决策状态（null = pending）。 */
  decided: 'accept' | 'reject' | null;
}

export interface HunkControlsHandlers {
  onAccept: (hunkIndex: number) => void;
  onReject: (hunkIndex: number) => void;
}

/** 测试导出：控件 DOM 标记。 */
export const DATA_HUNK_CONTROL = 'data-hunk-control';
export const DATA_HUNK_ACCEPT = 'data-hunk-accept';
export const DATA_HUNK_REJECT = 'data-hunk-reject';

class HunkControlWidget extends WidgetType {
  constructor(
    readonly info: HunkControlInfo,
    readonly handlers: HunkControlsHandlers,
  ) {
    super();
  }

  override eq(other: HunkControlWidget): boolean {
    return other.info.hunkIndex === this.info.hunkIndex && other.info.decided === this.info.decided;
  }

  override toDOM(): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'wt-hunk-controls';
    wrap.setAttribute(DATA_HUNK_CONTROL, String(this.info.hunkIndex));
    if (this.info.decided) {
      wrap.classList.add(this.info.decided === 'accept' ? 'is-accepted' : 'is-rejected');
      const label = document.createElement('span');
      label.className = 'wt-hunk-control-state';
      label.textContent = this.info.decided === 'accept' ? 'accepted' : 'rejected';
      wrap.appendChild(label);
    } else {
      const accept = document.createElement('button');
      accept.type = 'button';
      accept.className = 'wt-hunk-btn wt-hunk-btn-accept';
      accept.textContent = 'Accept';
      accept.title = 'Accept hunk (A)';
      accept.setAttribute(DATA_HUNK_ACCEPT, String(this.info.hunkIndex));
      accept.addEventListener('mousedown', (e) => e.stopPropagation());
      accept.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.handlers.onAccept(this.info.hunkIndex);
      });
      const reject = document.createElement('button');
      reject.type = 'button';
      reject.className = 'wt-hunk-btn wt-hunk-btn-reject';
      reject.textContent = 'Reject';
      reject.title = 'Reject hunk (R)';
      reject.setAttribute(DATA_HUNK_REJECT, String(this.info.hunkIndex));
      reject.addEventListener('mousedown', (e) => e.stopPropagation());
      reject.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.handlers.onReject(this.info.hunkIndex);
      });
      wrap.appendChild(accept);
      wrap.appendChild(reject);
    }
    return wrap;
  }

  override ignoreEvent(): boolean {
    // 让按钮的 click 事件正常冒泡到 DOM（CM6 readonly 下不干预）
    return false;
  }
}

function signatureOf(infos: HunkControlInfo[]): string {
  return infos.map((i) => `${i.hunkIndex}:${i.line}:${i.decided ?? ''}`).join('|');
}

function buildDecorations(
  view: EditorView,
  infos: HunkControlInfo[],
  handlers: HunkControlsHandlers,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const widgets: Array<{ pos: number; deco: Decoration }> = [];
  for (const info of infos) {
    if (!Number.isFinite(info.line) || info.line < 1) continue;
    const lineNumber = Math.min(Math.floor(info.line), view.state.doc.lines);
    if (lineNumber < 1) continue;
    const line = view.state.doc.line(lineNumber);
    const pos = Math.min(line.to, view.state.doc.length);
    widgets.push({
      pos,
      deco: Decoration.widget({ widget: new HunkControlWidget(info, handlers), side: 1 }),
    });
  }
  widgets.sort((a, b) => a.pos - b.pos);
  for (const w of widgets) builder.add(w.pos, w.pos, w.deco);
  return builder.finish();
}

/**
 * 创建 hunk 悬浮控件扩展。
 *
 * `getInfo` 在每次 view update 后读取；签名变化或 doc/viewport 变化时
 * 重建 decorations。React 侧 decisions / hunks 变化 → re-render →
 * extension 重建（extraCompartment reconfigure）→ 控件刷新。
 */
export function createHunkControlsExtension(
  getInfo: () => HunkControlInfo[],
  handlers: HunkControlsHandlers,
): Extension {
  return ViewPlugin.fromClass(
    class HunkControlsPlugin {
      decorations: DecorationSet;
      private lastSignature: string;

      constructor(view: EditorView) {
        const infos = getInfo();
        this.lastSignature = signatureOf(infos);
        this.decorations = buildDecorations(view, infos, handlers);
      }

      update(update: { view: EditorView; docChanged: boolean; viewportChanged: boolean }) {
        const infos = getInfo();
        const sig = signatureOf(infos);
        if (sig !== this.lastSignature || update.docChanged || update.viewportChanged) {
          this.lastSignature = sig;
          this.decorations = buildDecorations(update.view, infos, handlers);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
}
