# Monaco Editor 集成研究文档

**项目**: Petri Desktop  
**日期**: 2026-08-14  
**状态**: 研究阶段

---

## 1. 当前项目 Monaco 相关依赖分析

### 1.1 现有依赖检查

| 依赖 | 版本 | 用途 |
|------|------|------|
| `highlight.js` | ^11.11.1 | 代码高亮（已在使用） |
| `rehype-highlight` | ^7.0.2 | MDX 中代码块高亮 |
| **@monaco-editor/react** | 未安装 | - |
| **monaco-editor** | 未安装 | - |

### 1.2 当前代码高亮方案

项目使用 `highlight.js` 作为主要代码高亮方案，封装在 `frontend/src/components/ui/CodeHighlight.tsx` 中：

```typescript
// frontend/src/components/ui/CodeHighlight.tsx
import hljs from 'highlight.js';

export function HighlightedCode({
  code,
  language,
}: {
  code: string;
  language?: string | null;
}): React.ReactElement {
  const normalized = normalizeCodeLanguage(language || undefined);
  if (!normalized) return <code>{code}</code>;

  const html = hljs.highlight(code, {
    language: normalized,
    ignoreIllegals: true,
  }).value;
  return (
    <code
      className={`hljs language-${normalized}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
```

**已支持的语言**：
- R, Python, JavaScript, TypeScript, JSON, YAML, Bash, SQL, CSS, HTML, XML, Ruby, SCSS 等

**使用位置**：
- `SimpleChat.tsx` - AI 对话中的代码展示
- `RevisionCodeView.tsx` - Result Studio 代码视图
- MDX 渲染管道（通过 rehype-highlight）

### 1.3 版本兼容性评估

| 技术栈 | 当前版本 | Monaco 兼容性 |
|--------|----------|---------------|
| React | ^18.3.1 | 兼容 |
| TypeScript | ^5.5.4 | 兼容 |
| Vite | ^5.4.0 | 兼容 |
| Node | - | Monaco ^0.45+ 需要 ESM |

---

## 2. 集成方案设计

### 2.1 场景 A: Monaco 只读模式（Phase 1 Quick Win）

#### 2.1.1 目标

替代 `HighlightedCode` 组件，实现更丰富的代码展示体验。

#### 2.1.2 实现策略

```typescript
// frontend/src/components/ui/MonacoCodeViewer.tsx
import { lazy, Suspense, useMemo } from 'react';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

interface MonacoCodeViewerProps {
  code: string;
  language?: string;
  theme?: 'light' | 'dark';
  height?: string | number;
}

// 语言映射：highlight.js -> Monaco language ID
const LANGUAGE_MAP: Record<string, string> = {
  r: 'r',
  python: 'python',
  javascript: 'javascript',
  typescript: 'typescript',
  json: 'json',
  yaml: 'yaml',
  bash: 'shell',
  shell: 'shell',
  sql: 'sql',
  css: 'css',
  html: 'html',
  xml: 'xml',
  markdown: 'markdown',
};

export function MonacoCodeViewer({
  code,
  language,
  theme = 'dark',
  height = 'auto',
}: MonacoCodeViewerProps) {
  const monacoLanguage = useMemo(
    () => LANGUAGE_MAP[language?.toLowerCase() || ''] || 'plaintext',
    [language]
  );

  return (
    <Suspense fallback={<pre><code>{code}</code></pre>}>
      <MonacoEditor
        height={height}
        language={monacoLanguage}
        value={code}
        theme={theme === 'dark' ? 'vs-dark' : 'light'}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          fontSize: 13,
          fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
          automaticLayout: true,
          folding: true,
          renderLineHighlight: 'line',
          padding: { top: 8, bottom: 8 },
        }}
        loading={<pre><code>{code}</code></pre>}
      />
    </Suspense>
  );
}
```

#### 2.1.3 主题集成

```typescript
// 与现有 ThemeProvider 集成
import { useTheme } from '@/themes/ThemeProvider';

export function MonacoCodeViewerWithTheme(props: MonacoCodeViewerProps) {
  const { resolvedTheme } = useTheme();
  return (
    <MonacoCodeViewer
      {...props}
      theme={resolvedTheme}
    />
  );
}
```

#### 2.1.4 安装依赖

```bash
cd frontend
npm install @monaco-editor/react monaco-editor
```

---

### 2.2 场景 B: Monaco 完整编辑模式（Phase 2）

#### 2.2.1 目标

支持文件编辑、代码补全、自动保存、撤销/重做。

#### 2.2.2 架构设计

```
+-------------------------------------------------------------+
|                     React Component                         |
|  MonacoEditor (editable mode)                               |
+-------------------------------------------------------------+
                           |
                           v
+-------------------------------------------------------------+
|                   IPC Bridge Layer                          |
|  desktopBridge.ts (getBridge / requireBridge)              |
+-------------------------------------------------------------+
                           |
                           v
+-------------------------------------------------------------+
|                  Electron Main Process                      |
|  - file:read(path)                                         |
|  - file:write(path, content)                               |
|  - file:watch(path)                                        |
+-------------------------------------------------------------+
```

#### 2.2.3 IPC 通信设计

```typescript
// frontend/src/lib/electron.d.ts 扩展
interface DesktopFileBridge {
  read: (filePath: string, options?: { encoding?: string }) => Promise<string>;
  write: (filePath: string, content: string, options?: { encoding?: string }) => Promise<void>;
  watch: (filePath: string, callback: (event: 'change' | 'delete', path: string) => void) => () => void;
}

// frontend/src/hooks/useMonacoFileEditor.ts
import { useCallback, useRef, useState } from 'react';
import { getBridge } from '@/lib/desktopBridge';

interface UseMonacoFileEditorOptions {
  filePath: string;
  autoSave?: boolean;
  autoSaveDelay?: number;
}

export function useMonacoFileEditor({
  filePath,
  autoSave = true,
  autoSaveDelay = 2000,
}: UseMonacoFileEditorOptions) {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [modified, setModified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const originalContent = useRef<string>('');
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 读取文件
  const load = useCallback(async () => {
    const fileBridge = getBridge('file');
    if (!fileBridge) {
      setError('File bridge unavailable');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const text = await fileBridge.read(filePath);
      originalContent.current = text;
      setContent(text);
      setModified(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file');
    } finally {
      setLoading(false);
    }
  }, [filePath]);

  // 保存文件
  const save = useCallback(async () => {
    const fileBridge = getBridge('file');
    if (!fileBridge) {
      setError('File bridge unavailable');
      return false;
    }

    try {
      setSaving(true);
      await fileBridge.write(filePath, content);
      originalContent.current = content;
      setModified(false);
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save file');
      return false;
    } finally {
      setSaving(false);
    }
  }, [filePath, content]);

  // 内容变更处理
  const onChange = useCallback((value: string | undefined) => {
    const newContent = value || '';
    setContent(newContent);
    setModified(newContent !== originalContent.current);

    // 自动保存
    if (autoSave) {
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current);
      }
      autoSaveTimer.current = setTimeout(() => {
        void save();
      }, autoSaveDelay);
    }
  }, [autoSave, autoSaveDelay, save]);

  // 撤销到原始内容
  const revert = useCallback(() => {
    setContent(originalContent.current);
    setModified(false);
  }, []);

  // 清理定时器
  const cleanup = useCallback(() => {
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
    }
  }, []);

  return {
    content,
    loading,
    saving,
    modified,
    error,
    load,
    save,
    revert,
    onChange,
    cleanup,
  };
}
```

#### 2.2.4 完整编辑器组件

```typescript
// frontend/src/components/monaco/MonacoFileEditor.tsx
import { lazy, Suspense, useCallback, useEffect, useMemo } from 'react';
import { useMonacoFileEditor } from '@/hooks/useMonacoFileEditor';
import { useTheme } from '@/themes/ThemeProvider';
import { Icon } from '@/components/icons/Icon';
import styles from './MonacoFileEditor.module.css';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

interface MonacoFileEditorProps {
  filePath: string;
  readOnly?: boolean;
  autoSave?: boolean;
  onSave?: (content: string) => void;
}

export function MonacoFileEditor({
  filePath,
  readOnly = false,
  autoSave = true,
  onSave,
}: MonacoFileEditorProps) {
  const { resolvedTheme } = useTheme();
  const {
    content,
    loading,
    saving,
    modified,
    error,
    load,
    save,
    revert,
    onChange,
    cleanup,
  } = useMonacoFileEditor({
    filePath,
    autoSave,
  });

  useEffect(() => {
    void load();
    return cleanup;
  }, [load, cleanup]);

  const handleSave = useCallback(async () => {
    const success = await save();
    if (success) {
      onSave?.(content);
    }
  }, [save, onSave, content]);

  // 键盘快捷键：Cmd/Ctrl + S 保存
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void handleSave();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  const monacoLanguage = useMemo(() => {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const map: Record<string, string> = {
      r: 'r', py: 'python', js: 'javascript', ts: 'typescript',
      jsx: 'javascript', tsx: 'typescript', json: 'json', yaml: 'yaml',
      yml: 'yaml', sh: 'shell', bash: 'shell', sql: 'sql',
      css: 'css', html: 'html', xml: 'xml', md: 'markdown',
    };
    return map[ext] || 'plaintext';
  }, [filePath]);

  const fileName = useMemo(() => {
    const parts = filePath.split('/');
    return parts[parts.length - 1];
  }, [filePath]);

  if (loading) {
    return <div className={styles.loading}>Loading {fileName}...</div>;
  }

  if (error) {
    return (
      <div className={styles.error}>
        <Icon name="alert-circle" size={16} />
        <span>{error}</span>
        <button onClick={() => void load()}>Retry</button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.toolbar}>
        <span className={styles.filename}>
          {fileName}
          {modified && <span className={styles.modified}>●</span>}
        </span>
        <div className={styles.actions}>
          {modified && (
            <button onClick={revert} title="Revert changes">
              <Icon name="undo" size={14} />
              Revert
            </button>
          )}
          {modified && (
            <button onClick={() => void handleSave()} disabled={saving}>
              <Icon name="save" size={14} />
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
          {!modified && !saving && <span className={styles.saved}>Saved</span>}
        </div>
      </header>
      <div className={styles.editor}>
        <Suspense fallback={<div className={styles.loading}>Loading editor...</div>}>
          <MonacoEditor
            height="100%"
            language={monacoLanguage}
            value={content}
            theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
            onChange={onChange}
            options={{
              readOnly,
              minimap: { enabled: true },
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              fontSize: 13,
              fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
              automaticLayout: true,
              folding: true,
              renderLineHighlight: 'all',
              padding: { top: 8, bottom: 8 },
              suggestOnTriggerCharacters: true,
              quickSuggestions: true,
              tabSize: 2,
              insertSpaces: true,
              formatOnPaste: true,
              formatOnType: true,
            }}
            loading={<div className={styles.loading}>Initializing Monaco...</div>}
          />
        </Suspense>
      </div>
    </div>
  );
}
```

---

## 3. 性能优化方案

### 3.1 Monaco Editor 懒加载策略

Monaco Editor 打包后约 2-3MB，懒加载是必须的：

```typescript
// 使用 React.lazy + Suspense
const MonacoEditor = lazy(() => import('@monaco-editor/react'));

// 或者使用动态导入钩子
import { useDynamicScript } from '@/hooks/useDynamicScript';

function useMonaco() {
  const { ready, error } = useDynamicScript(
    'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/loader.js'
  );
  // ...
}
```

### 3.2 大文件处理（>1MB）

Monaco 在处理大文件时可能卡顿，需要限制：

```typescript
const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const LARGE_FILE_THRESHOLD = 500 * 1024; // 500KB 警告

function MonacoFileViewer({ filePath, content }: MonacoFileViewerProps) {
  const [isLarge, setIsLarge] = useState(false);

  useEffect(() => {
    setIsLarge(content.length > LARGE_FILE_THRESHOLD);
  }, [content]);

  if (content.length > MAX_FILE_SIZE) {
    return (
      <div className={styles.largeFileWarning}>
        <Icon name="alert-triangle" size={20} />
        <p>File too large for Monaco editor ({formatBytes(content.length)})</p>
        <p>Consider using the Read-only mode or splitting the file.</p>
      </div>
    );
  }

  return (
    <MonacoEditor
      // ...
      options={{
        ...options,
        // 大文件禁用某些特性
        ...(isLarge && {
          minimap: { enabled: false },
          folding: false,
          renderLineHighlight: 'none',
          scrollbar: { vertical: 'auto', horizontal: 'auto' },
        }),
      }}
    />
  );
}
```

### 3.3 内存占用优化

```typescript
// 配置 Web Worker
const worker = new Worker(
  new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
  { type: 'module' }
);

// 配置语言服务 Worker
self.MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === 'json') {
      return new Worker(new URL('monaco-editor/esm/vs/language/json/json.worker.js', import.meta.url));
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return new Worker(new URL('monaco-editor/esm/vs/language/css/css.worker.js', import.meta.url));
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new Worker(new URL('monaco-editor/esm/vs/language/html/html.worker.js', import.meta.url));
    }
    if (label === 'typescript' || label === 'javascript') {
      return new Worker(new URL('monaco-editor/esm/vs/language/typescript/ts.worker.js', import.meta.url));
    }
    return new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url));
  },
};
```

### 3.4 Vite 特殊配置

```typescript
// vite.config.ts
export default defineConfig({
  optimizeDeps: {
    include: ['monaco-editor/esm/vs/editor/editor.api'],
    // 预构建包含的语言
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          monaco: ['monaco-editor'],
        },
      },
    },
  },
});
```

---

## 4. 具体实施建议

### 4.1 需要修改的文件列表

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/package.json` | 修改 | 添加 @monaco-editor/react 依赖 |
| `frontend/src/components/ui/MonacoCodeViewer.tsx` | 新增 | 只读代码展示组件 |
| `frontend/src/components/monaco/MonacoFileEditor.tsx` | 新增 | 完整编辑模式组件 |
| `frontend/src/hooks/useMonacoFileEditor.ts` | 新增 | 文件编辑 Hook |
| `frontend/src/lib/electron.d.ts` | 修改 | 扩展 file bridge 类型 |
| `src/preload.js` | 修改 | 暴露 file read/write API |
| `src/main.js` | 修改 | 添加 file IPC handlers |
| `frontend/vite.config.ts` | 修改 | Monaco 优化配置 |
| `frontend/src/components/copilot/SimpleChat.tsx` | 修改 | 可选：替换 HighlightedCode |
| `frontend/src/components/result-studio/RevisionCodeView.tsx` | 修改 | 可选：使用 Monaco 展示 |

### 4.2 新增组件结构

```
frontend/src/
├── components/
│   ├── ui/
│   │   └── MonacoCodeViewer.tsx    # Phase 1
│   └── monaco/
│       ├── MonacoFileEditor.tsx    # Phase 2
│       └── MonacoFileEditor.module.css
└── hooks/
    └── useMonacoFileEditor.ts      # Phase 2
```

### 4.3 IPC 通信设计（Phase 2）

```typescript
// src/main.js 添加
ipcMain.handle('file:read', async (event, filePath) => {
  // 验证路径安全性
  return fs.readFileSync(filePath, 'utf-8');
});

ipcMain.handle('file:write', async (event, filePath, content) => {
  // 验证路径安全性
  fs.writeFileSync(filePath, content, 'utf-8');
  return true;
});

// src/preload.js 暴露
contextBridge.exposeInMainWorld('petriDesktop', {
  file: {
    read: (path) => ipcRenderer.invoke('file:read', path),
    write: (path, content) => ipcRenderer.invoke('file:write', path, content),
  },
  // ... 现有 API
});
```

### 4.4 状态管理方案

遵循项目规范（React useState + 自定义 hooks），不使用 zustand：

```typescript
// 前端状态完全由组件内部管理
// IPC 状态通过 desktopBridge 获取
// 无需全局状态管理
```

### 4.5 测试建议

```typescript
// frontend/src/components/ui/MonacoCodeViewer.test.tsx
describe('MonacoCodeViewer', () => {
  it('renders code in read-only mode', () => {
    render(
      <MonacoCodeViewer
        code='print("hello")'
        language="python"
        theme="dark"
      />
    );
    // ...
  });
});
```

---

## 5. 风险与注意事项

### 5.1 已知风险

| 风险 | 缓解措施 |
|------|----------|
| 包体积增大 (~3MB) | 懒加载 + code splitting |
| 首次加载延迟 | 显示 loading skeleton |
| 大文件卡顿 | 文件大小限制 + 警告 |
| 内存占用高 | Web Worker 分离 + 适时销毁 |

### 5.2 兼容性考虑

- **Electron 版本**：确保与 Monaco 的 WebView 兼容
- **macOS/Windows**：Monaco 在两个平台表现一致
- **ARM 架构**：Monaco 有原生支持

### 5.3 替代方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| @monaco-editor/react | React 官方集成，API 友好 | 包体积大 |
| @codemirror/react | 轻量，可定制性强 | 需要更多配置 |
| 直接使用 monaco-editor | 完整控制 | 需要自己管理 React 生命周期 |

---

## 6. 推荐实施路径

1. **Phase 1**（预计 1-2 天）
   - 安装依赖
   - 实现 `MonacoCodeViewer` 只读组件
   - 替换 `RevisionCodeView` 中的代码展示
   - 添加主题适配

2. **Phase 2**（预计 3-5 天）
   - 添加 IPC file bridge
   - 实现 `MonacoFileEditor` 编辑组件
   - 添加自动保存、撤销/重做
   - 集成代码补全

3. **Phase 3**（可选）
   - 多文件标签页
   - 高级搜索替换
   - Git 集成

---

## 7. 参考资源

- [@monaco-editor/react 官方文档](https://www.npmjs.com/package/@monaco-editor/react)
- [Monaco Editor 配置选项](https://microsoft.github.io/monaco-editor/api/interfaces/monaco.editor.IStandaloneEditorConstructionOptions.html)
- [Petri Desktop 现有代码高亮实现](./CodeHighlight.tsx)
