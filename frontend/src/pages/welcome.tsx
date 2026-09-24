import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { useBackendStatus } from '@/components/backend/BackendStatusProvider';
import { connectSshHost, createProject, listProjects, listSshRemoteDirs, listSshTargetCandidates, validateSshProject, type SshTargetCandidate } from '@/lib/project-store';
import type { Project } from '@/lib/project-types';
import { branchApi } from '@/lib/branchBridge';
import { FolderPicker } from '@/components/desktop/FolderPicker';
import { dispatchGewuEvent, gewuEvents } from '@/lib/events';
import { SimpleChat } from '@/components/copilot/SimpleChat';
import {
  clearConversationDraft,
  loadConversationDraft,
  saveConversationDraft,
} from '@/components/copilot/conversationDraft';
import styles from './welcome.module.css';

/**
 * BLOCK-80 + UI-341 — 欢迎页（ZCode 形态、本项目内容）：时段问候 + 项目/分支
 * 选择 + **内嵌真正的聊天模块（SimpleChat）**——用户裁决「不需要重写，调用这个
 * 模块不就可以了吗」，不再手搓输入框：完全访问/知识空间/模型选择/历史回溯
 * 全部原生复用。
 *
 * UI-373 — 冷启动不预选工作区（用户裁决「不应该确定的工作区」）：选择器保持
 * 「选择项目」，**输入框常驻**可先行键入；未选项目时发送被 sendGuard 拦截
 * （展开选择器 + 提示），已键入草稿随选中迁移不丢失。首载 listProjects 带
 * 退避重试（UI-369 同族：dev 栈重启竞态曾致「选择项目 + 无输入框」死态）。
 *
 * 首发即建会话：SimpleChat 在 conversationId=null 时 send 自行
 * createConversationForRun（走 useConversations().create，自动写共享缓存，
 * 左栏立即可见）并回调 onConversationChange —— 此刻导航进项目工作区；
 * run 由服务端持有，工作区经 SSE 回放/恢复机制重新挂载，聊天无缝衔接。
 *
 * 快捷 chips = 一键直发 starter prompt（copilotAsk 事件，由内嵌 SimpleChat
 * 消费，无会话时自动建会话）；项目创建流（打开文件夹/远程连接）在下拉面板
 * 内闭环（UI-337）。
 */

const QUICK_CHIPS: Array<{ label: string; prompt: string }> = [
  { label: '差异分析', prompt: '请用 DESeq2 对本项目 counts 数据做差异表达分析，并给出火山图与热图。' },
  { label: '富集分析', prompt: '请对差异基因做 GO/KEGG 富集分析，输出气泡图与结果表。' },
  { label: '单细胞聚类', prompt: '请用 Seurat 对单细胞数据做标准流程（QC→PCA→UMAP→聚类），并给出 marker 基因表。' },
  { label: '报告解读', prompt: '请解读项目内最新的分析结果，并生成一份简明报告。' },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return '夜深了，分析随时可以开始';
  if (h < 12) return '早上好呀，新的一天开始啦';
  if (h < 14) return '中午好，先跑个分析？';
  if (h < 18) return '下午好，继续推进项目';
  return '晚上好，今晚想分析点什么';
}

function baseName(p: string): string {
  const norm = String(p || '').replace(/[\\/]+$/, '');
  const idx = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'));
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

/**
 * UI-373 — 未选项目态（projectId=''）下键入的 composer 草稿随选中迁移。
 * SimpleChat 以 key=selectedId 换挂载，新实例挂载即读 (目标项目, null) 草稿，
 * 故迁移必须在新挂载读取之前同步完成（调用点：选中动作处理器 / 首次解析）。
 */
function carryNoProjectDraft(targetId: string) {
  const carried = loadConversationDraft('', null);
  if (!carried) return;
  if (!loadConversationDraft(targetId, null)) saveConversationDraft(targetId, null, carried);
  clearConversationDraft('', null);
}

export default function Welcome(): React.ReactElement {
  const backendStatus = useBackendStatus();
  const navigate = useNavigate();
  const location = useLocation();
  // UI-338 加映 — 从工作区「新建任务」进入时，默认预选鼠标所在的项目
  // （handleNavigateToHome 以 ?project=<id> 查询参数传递；此处从 URL 读取）
  const preselectProjectId = new URLSearchParams(location.search).get('project') || '';
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string>('');
  const [branchName, setBranchName] = useState<string>('');
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');

  // UI-337 — 项目下拉面板
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [panelSection, setPanelSection] = useState<'none' | 'folder' | 'ssh'>('none');
  const [folderPicking, setFolderPicking] = useState(false);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [folderName, setFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [sshTargets, setSshTargets] = useState<SshTargetCandidate[]>([]);
  const [sshAlias, setSshAlias] = useState('');
  const [sshRemotePath, setSshRemotePath] = useState('/root');
  const [sshValidating, setSshValidating] = useState(false);

  useEffect(() => {
    // UI-373 — 首载退避重试（UI-369 AppRail 同族缺陷）：dev 栈重启竞态下窗口
    // 先于后端就绪，单发 listProjects 抛错曾致「选择项目 + 无输入框」死态且再
    // 无重试（左栏已自愈而本页没有）。退避 0/2/5/10/15s，成功即停，unmount
    // 取消；退避窗口耗尽仍失败则如实给出空态。
    // 冷启动不再自动选中最近项目（用户裁决「不应该确定的工作区」）：仅显式
    // ?project= 预选生效，选择器保持「选择项目」，输入框常驻可先行键入。
    let cancelled = false;
    const backoffMs = [0, 2000, 5000, 10000, 15000];
    void (async () => {
      for (const wait of backoffMs) {
        if (cancelled) return;
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        if (cancelled) return;
        try {
          const list = await listProjects();
          if (cancelled) return;
          const sorted = [...list].sort((a, b) => {
            const bt = new Date(b.updatedAt || b.createdAt || 0).getTime();
            const at = new Date(a.updatedAt || a.createdAt || 0).getTime();
            return bt - at;
          });
          setProjects(sorted);
          if (preselectProjectId) carryNoProjectDraft(preselectProjectId);
          setSelectedId((cur) => cur || preselectProjectId || '');
          setLoaded(true);
          return;
        } catch { /* 后端未就绪/瞬断：退避后重试 */ }
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [preselectProjectId]);

  // 当前分支徽标（只读展示；切换属变更操作，留在审阅面）
  useEffect(() => {
    if (!selectedId) { setBranchName(''); return; }
    let alive = true;
    branchApi.list(selectedId)
      .then((branches) => {
        if (!alive) return;
        const active = branches.find((b) => b.isActive) || branches[0] || null;
        setBranchName(active ? String((active as { name?: string }).name || active.id || '') : '');
      })
      .catch(() => { if (alive) setBranchName(''); });
    return () => { alive = false; };
  }, [selectedId]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedId) || null,
    [projects, selectedId]
  );
  const backendReady = backendStatus.serverUp !== false;
  // UI-373 — 输入框常驻（backendReady 即挂载）：未选项目时选择器显示「选择项目」，
  // composer 仍可先行键入（发送由 sendGuard 拦截并展开选择器）；此前
  // `Boolean(selectedProject) && backendReady` 让冷启动页面退化成纯选择器。
  const chatMounted = backendReady;

  // UI-373 — 选中动作统一入口：未选项目态键入的草稿在此同步迁移（先于
  // key 换挂载读取），所有选中路径（行点击/去重收编/创建后切换）走这里。
  function selectProject(id: string) {
    if (!selectedId) carryNoProjectDraft(id);
    setSelectedId(id);
  }

  // UI-373 — 未选项目时拦截发送：展开选择器并提示，输入保留不消费
  // （覆盖输入框 Enter 与快捷 chips 的 copilotAsk 直发两条路径）。
  function guardNoProjectSend(): string {
    setPickerOpen(true);
    setHint('先选择一个项目，再开始任务。');
    return 'no-project';
  }

  // UI-338 加映 — SSH「先连接再补全」状态
  const [sshConnected, setSshConnected] = useState(false);
  const [sshConnecting, setSshConnecting] = useState(false);
  const [dirSuggestions, setDirSuggestions] = useState<string[]>([]);
  const [dirsLoading, setDirsLoading] = useState(false);
  const dirDebounceRef = useRef<number | null>(null);

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, search]);

  async function refreshProjects(selectId?: string) {
    const list = await listProjects();
    const sorted = [...list].sort((a, b) => {
      const bt = new Date(b.updatedAt || b.createdAt || 0).getTime();
      const at = new Date(a.updatedAt || a.createdAt || 0).getTime();
      return bt - at;
    });
    setProjects(sorted);
    if (selectId) selectProject(selectId);
  }

  function openPicker() {
    setPickerOpen((o) => !o);
    setPanelSection('none');
    setSearch('');
  }

  // UI-338 加映 — 打开文件夹：优先调用系统资源管理器原生对话框
  // （files.openDirectoryDialog，可新建目录）；无桥环境（纯浏览器态）回落
  // 应用内 FolderPicker。取消选择则停留当前面板。
  async function openFolderDialogOrFallback() {
    const dialog = window.biof3Desktop?.files?.openDirectoryDialog;
    if (typeof dialog === 'function') {
      setPanelSection('folder');
      try {
        const picked = await dialog();
        if (picked) {
          setFolderPath(picked);
          setFolderName(baseName(picked));
        } else {
          setPanelSection('none'); // 用户取消资源管理器 → 收起
        }
        return;
      } catch { /* 原生对话框失败 → 回落应用内选择器 */ }
    }
    setPanelSection('folder');
    setFolderPicking(true);
  }

  function openSshSection() {
    setPanelSection('ssh');
    listSshTargetCandidates()
      .then((targets) => {
        setSshTargets(targets);
        const first = targets.find((t) => t.registered) || targets[0];
        if (first) setSshAlias((cur) => cur || first.alias);
      })
      .catch(() => setSshTargets([]));
  }

  // UI-340 — 工作区去重：同形态 + 同路径（尾部斜杠归一）视为同一工作区，
  // 命中既有项目则不重复创建，直接切换选中并提示。
  function findExistingProject(kind: 'local' | 'ssh', path: string, sshHost?: string): Project | null {
    const norm = (v: string) => String(v || '').replace(/[\\/]+$/, '');
    const target = norm(path);
    return projects.find((p) => {
      if ((p.workspaceKind || 'local') !== kind) return false;
      if (kind === 'ssh') return (p.sshHost || '') === (sshHost || '') && norm(p.remotePath || '') === target;
      return norm(p.workspacePath || '') === target;
    }) || null;
  }

  function adoptExisting(existing: Project) {
    selectProject(existing.id);
    setPickerOpen(false);
    setPanelSection('none');
    setFolderPath(null);
    setHint(`已存在指向同一工作区的项目「${existing.name}」，已为你切换`);
  }

  async function createFromFolder() {
    if (!folderPath || !folderName.trim() || creatingFolder) return;
    setCreatingFolder(true);
    setError('');
    setHint('');
    try {
      const existing = findExistingProject('local', folderPath);
      if (existing) {
        adoptExisting(existing);
        return;
      }
      const project = await createProject({ name: folderName.trim(), modality: 'general', workspacePath: folderPath });
      await refreshProjects(project.id);
      setPickerOpen(false);
      setPanelSection('none');
      setFolderPath(null);
      setFolderName('');
    } catch (e) {
      setError(`创建项目失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCreatingFolder(false);
    }
  }

  async function createFromSsh() {
    if (!sshAlias || !sshRemotePath || sshValidating) return;
    setSshValidating(true);
    setError('');
    setHint('');
    try {
      // 去重优先：同服务器+同路径已存在项目 → 直接切换，不再造第二个
      const existing = findExistingProject('ssh', sshRemotePath, sshAlias);
      if (existing) {
        adoptExisting(existing);
        return;
      }
      const v = await validateSshProject({ alias: sshAlias, remotePath: sshRemotePath });
      if (!v.ok) throw new Error(v.error || '校验失败');
      const project = await createProject({
        name: `${sshAlias} · ${baseName(sshRemotePath)}`,
        modality: 'general',
        workspaceKind: 'ssh',
        sshHost: sshAlias,
        remotePath: sshRemotePath,
      });
      await refreshProjects(project.id);
      setPickerOpen(false);
      setPanelSection('none');
    } catch (e) {
      setError(`远程连接失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSshValidating(false);
    }
  }

  // ── UI-338 加映 — SSH「先连接再补全」处理器 ──
  function parseRemotePathInput(input: string): { parent: string; stub: string } | null {
    if (!input.startsWith('/')) return null;
    const cut = input.lastIndexOf('/');
    if (cut < 0) return null;
    return { parent: input.slice(0, cut + 1), stub: input.slice(cut + 1) };
  }

  async function connectForBrowse() {
    if (!sshAlias || sshConnecting) return;
    setSshConnecting(true);
    setError('');
    const r = await connectSshHost(sshAlias);
    setSshConnecting(false);
    if (!r.ok) {
      setError(r.error || '连接失败');
      return;
    }
    setSshConnected(true);
    const home = r.home && !r.home.endsWith('/') ? `${r.home}/` : (r.home || '/');
    setSshRemotePath(home);
    void fetchDirSuggestions(home, true);
  }

  async function fetchDirSuggestions(path: string, force = false) {
    if ((!sshConnected && !force) || !sshAlias) return;
    const parsed = parseRemotePathInput(path);
    if (!parsed) { setDirSuggestions([]); return; }
    setDirsLoading(true);
    try {
      const r = await listSshRemoteDirs(sshAlias, parsed.parent);
      if (r.ok && r.dirs) {
        const actualParent = (r.path || parsed.parent).replace(/\/+$/, '');
        const cands = r.dirs
          .filter((d) => d.name.startsWith(parsed.stub))
          .map((d) => `${actualParent}/${d.name}/`);
        setDirSuggestions(cands);
      } else {
        setDirSuggestions([]);
      }
    } catch {
      setDirSuggestions([]);
    } finally {
      setDirsLoading(false);
    }
  }

  function onRemotePathInput(v: string) {
    setSshRemotePath(v);
    if (!sshConnected) return;
    if (dirDebounceRef.current) window.clearTimeout(dirDebounceRef.current);
    dirDebounceRef.current = window.setTimeout(() => void fetchDirSuggestions(v), 300);
  }

  function onAliasInput(v: string) {
    setSshAlias(v);
    // 换目标必须重新连接（连接态与旧别名绑定）
    setSshConnected(false);
    setDirSuggestions([]);
  }

  // UI-341 — 快捷 chips 一键直发（copilotAsk 由内嵌 SimpleChat 消费）
  function launchChip(prompt: string) {
    dispatchGewuEvent(gewuEvents.copilotAsk, { prompt });
  }

  return (
    <div className={styles.welcome} aria-label="欢迎页">
      {/* UI-424 — 顶部「← 返回」按钮退役（用户裁决「左上角的返回不需要了」）：
          落地页语义下「返回」概念别扭，且标题栏 bare 化后页面干净优先；
          历史后退（Alt+←/鼠标侧键）仍可用，选项目/打开文件夹即离开本页。 */}
      <div className={styles.welcomeInner}>
        <h1 className={styles.greeting}>{greeting()}</h1>
        <p className={styles.welcomeSub}>选择项目，直接开始你的分析任务。</p>

        <div className={styles.composerCard}>
          <div className={styles.composerTopRow}>
            <div className={styles.pickerWrap}>
              <button
                type="button"
                className={styles.pickerTrigger}
                onClick={openPicker}
                aria-expanded={pickerOpen}
                aria-label="选择项目"
              >
                <Icon name="folder" size={14} />
                <span>{selectedProject ? selectedProject.name : loaded ? '选择项目' : '项目加载中…'}</span>
                <Icon name={pickerOpen ? 'chevron-up' : 'chevron-down'} size={12} />
              </button>
              {pickerOpen && (
                <>
                  <button
                    type="button"
                    className={styles.pickerOverlay}
                    onClick={() => setPickerOpen(false)}
                    aria-label="关闭项目列表"
                  />
                  <div className={styles.projectPanel} role="listbox" aria-label="工作区列表">
                    <input
                      className={styles.projectSearch}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="搜索工作区"
                      aria-label="搜索工作区"
                    />
                    <div className={styles.projectList}>
                      {filteredProjects.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className={`${styles.projectRow} ${p.id === selectedId ? styles.projectRowActive : ''}`}
                          onClick={() => { selectProject(p.id); setPickerOpen(false); setPanelSection('none'); }}
                        >
                          <Icon name="folder" size={14} />
                          <span className={styles.projectRowName}>{p.name}</span>
                          {p.workspaceKind === 'ssh' && <span className={styles.projectRowTag}>SSH</span>}
                          {p.id === selectedId && <Icon name="check" size={13} />}
                        </button>
                      ))}
                      {filteredProjects.length === 0 && (
                        <div className={styles.projectRowEmpty}>无匹配工作区</div>
                      )}
                    </div>
                    <div className={styles.panelActions}>
                      {panelSection === 'folder' ? (
                        <div className={styles.actionForm}>
                          {folderPath ? (
                            <>
                              <input
                                className={styles.actionInput}
                                value={folderName}
                                onChange={(e) => setFolderName(e.target.value)}
                                placeholder="项目名称"
                                aria-label="项目名称"
                              />
                              <div className={styles.actionPath} title={folderPath}>{folderPath}</div>
                              <div className={styles.actionBtnRow}>
                                <button type="button" className={styles.actionBack} onClick={() => { setPanelSection('none'); setFolderPath(null); }}>返回</button>
                                <button type="button" className={styles.actionPrimary} onClick={() => void createFromFolder()} disabled={!folderName.trim() || creatingFolder}>
                                  {creatingFolder ? '创建中…' : '确认创建'}
                                </button>
                              </div>
                            </>
                          ) : folderPicking ? (
                            <>
                              <FolderPicker
                                initialPath=""
                                pickLabel="选择此文件夹"
                                onPick={(picked: string) => { setFolderPath(picked); setFolderName(baseName(picked)); }}
                                onCancel={() => setPanelSection('none')}
                              />
                            </>
                          ) : (
                            <button type="button" className={styles.panelAction} onClick={() => void openFolderDialogOrFallback()}>
                              <Icon name="folder" size={14} /> 选择文件夹…
                            </button>
                          )}
                        </div>
                      ) : panelSection === 'ssh' ? (
                        <div className={styles.actionForm}>
                          {/* UI-338 加映 — 目标别名可输入自动补全（datalist 挂已注册目标）+「连接」先建立会话 */}
                          <div className={styles.sshAliasRow}>
                            <input
                              className={styles.actionInput}
                              value={sshAlias}
                              onChange={(e) => onAliasInput(e.target.value)}
                              aria-label="远程目标"
                              placeholder="输入或选择目标别名"
                              list="welcome-ssh-targets"
                              autoComplete="off"
                            />
                            <datalist id="welcome-ssh-targets">
                              {sshTargets.map((t) => (
                                <option key={t.alias} value={t.alias}>{t.label}</option>
                              ))}
                            </datalist>
                            {sshConnected ? (
                              <span className={styles.branchChip} data-testid="ssh-connected-chip">
                                <Icon name="check" size={12} /> 已连接
                              </span>
                            ) : (
                              <button
                                type="button"
                                className={styles.actionPrimary}
                                onClick={() => void connectForBrowse()}
                                disabled={!sshAlias || sshConnecting}
                              >
                                {sshConnecting ? '连接中…' : '连接'}
                              </button>
                            )}
                          </div>
                          <input
                            className={styles.actionInput}
                            value={sshRemotePath}
                            onChange={(e) => onRemotePathInput(e.target.value)}
                            placeholder="远程路径，如 /root/项目目录"
                            aria-label="远程路径"
                          />
                          {sshConnected && (
                            <div className={styles.dirSuggestions} aria-label="远程目录建议">
                              {dirsLoading ? (
                                <div className={styles.actionHint}>目录读取中…</div>
                              ) : dirSuggestions.length > 0 ? (
                                dirSuggestions.slice(0, 8).map((cand) => (
                                  <button
                                    key={cand}
                                    type="button"
                                    className={styles.dirSuggestion}
                                    onClick={() => { onRemotePathInput(cand); void fetchDirSuggestions(cand); }}
                                  >
                                    {cand}
                                  </button>
                                ))
                              ) : (
                                <div className={styles.actionHint}>无子目录建议——可直接输入或创建</div>
                              )}
                            </div>
                          )}
                          <div className={styles.actionBtnRow}>
                            <button type="button" className={styles.actionBack} onClick={() => setPanelSection('none')}>返回</button>
                            <button type="button" className={styles.actionPrimary} onClick={() => void createFromSsh()} disabled={!sshAlias || !sshRemotePath || sshValidating}>
                              {sshValidating ? '校验中…' : '校验并创建'}
                            </button>
                          </div>
                          <div className={styles.actionHint}>新主机请用左栏 🌐 远程连接入口注册（IP+密码一键装公钥）。</div>
                        </div>
                      ) : (
                        <>
                          <button type="button" className={styles.panelAction} onClick={() => void openFolderDialogOrFallback()}>
                            <Icon name="folder" size={14} /> 打开文件夹
                          </button>
                          <button type="button" className={styles.panelAction} onClick={openSshSection}>
                            <Icon name="globe" size={14} /> 远程连接
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
            {branchName && (
              <span className={styles.branchChip} title="当前分支（切换分支请到审阅面）">
                <Icon name="git-branch" size={13} /> {branchName}
              </span>
            )}
          </div>

          {/* UI-341 加映 — 内嵌真正的聊天模块（composer-only 变体：欢迎页
              不展示消息流/空态/建议卡，只保留输入框与控件行）；项目切换
              按钮收进对话框左上角（上方 composerTopRow）。
              UI-373 — 输入框常驻：未选项目时 projectId=''（内部按空项目
              待机，不拉会话），发送由 sendGuard 拦截并展开选择器；选中后
              key 换挂载切换到该项目，未发送的草稿随选中迁移不丢失。 */}
          {chatMounted && (
            <div className={styles.chatMount}>
              <SimpleChat
                key={selectedId || 'none'}
                projectId={selectedId}
                conversationId={null}
            onConversationChange={() => void navigate(`/project/${selectedId}`)}
                ownsCopilotAsk
                composerOnly
                sendGuard={selectedProject ? undefined : guardNoProjectSend}
              />
            </div>
          )}
          {!backendReady && (
            <p className={styles.welcomeSub}>本地分析服务未就绪——启动服务后即可在这里直接开始任务。</p>
          )}
        {/* UI-341 — error/hint 反馈行：创建失败原因与去重提示（UI-340
            「已为你切换」）必须可见，内嵌聊天后不再有 composerFoot 承载 */}
        {error && (
          <p className={styles.errorText} role="alert">{error}</p>
        )}
        {hint && !error && (
          <p className={styles.actionHint}>{hint}</p>
        )}
        </div>

        <div className={styles.chips} aria-label="快捷任务">
          {QUICK_CHIPS.map((chip) => (
            <button
              key={chip.label}
              type="button"
              className={styles.chip}
              onClick={() => launchChip(chip.prompt)}
              title={chip.prompt}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
