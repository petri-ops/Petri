import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { useBackendStatus } from '@/components/backend/BackendStatusProvider';
import { createProject, listProjects, listSshTargetCandidates, validateSshProject, type SshTargetCandidate } from '@/lib/project-store';
import type { Project } from '@/lib/project-types';
import { createConversation } from '@/components/copilot/copilotConversationsClient';
import { branchApi } from '@/lib/branchBridge';
import { FolderPicker } from '@/components/desktop/FolderPicker';
import styles from './welcome.module.css';

/**
 * BLOCK-80 — 欢迎页（ZCode 形态、本项目内容）：时段问候 + 项目/分支选择 +
 * 首问输入框 + 领域快捷 chips。发送 = 创建会话 → sessionStorage 交接首问 →
 * 导航项目工作区由工作区派发 copilotAsk 启动。
 *
 * UI-337 — 项目选择器升级为 ZCode 式下拉面板：搜索工作区 + 项目清单（✓ 当前）
 * + 打开文件夹（FolderPicker 选目录 → 命名 → 创建）+ 远程连接（已注册目标别名
 * + 远程路径 → 校验并创建）。「管理项目」独立页面随之取消（入口即面板）。
 */

const WELCOME_LAUNCH_KEY = 'gewu.welcomeLaunch';

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

export default function Welcome(): React.ReactElement {
  const backendStatus = useBackendStatus();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string>('');
  const [branchName, setBranchName] = useState<string>('');
  const [draft, setDraft] = useState('');
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState('');

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
    let alive = true;
    listProjects()
      .then((list) => {
        if (!alive) return;
        const sorted = [...list].sort((a, b) => {
          const bt = new Date(b.updatedAt || b.createdAt || 0).getTime();
          const at = new Date(a.updatedAt || a.createdAt || 0).getTime();
          return bt - at;
        });
        setProjects(sorted);
        setSelectedId((cur) => cur || sorted[0]?.id || '');
        setLoaded(true);
      })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

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
  const canSend = Boolean(selectedProject) && draft.trim().length > 0 && !launching && backendReady;

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
    if (selectId) setSelectedId(selectId);
  }

  function openPicker() {
    setPickerOpen((o) => !o);
    setPanelSection('none');
    setSearch('');
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

  async function createFromFolder() {
    if (!folderPath || !folderName.trim() || creatingFolder) return;
    setCreatingFolder(true);
    setError('');
    try {
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
    try {
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

  async function launch() {
    if (!canSend || !selectedProject) return;
    setLaunching(true);
    setError('');
    try {
      const conv = await createConversation('新任务', undefined, selectedProject.id);
      if (!conv) throw new Error('会话创建失败');
      try {
        sessionStorage.setItem(WELCOME_LAUNCH_KEY, JSON.stringify({ conversationId: conv.id, prompt: draft.trim() }));
      } catch { /* 存储不可用时仍导航，用户可在工作区手动发送 */ }
      navigate(`/project/${selectedProject.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLaunching(false);
    }
  }

  return (
    <div className={styles.welcome} aria-label="欢迎页">
      {/* UI-338 — 退出按钮：欢迎页无左栏/无其他出口；有历史则后退，
          冷启动（无历史）进最近项目工作区 */}
      <div className={styles.exitRow}>
        <button
          type="button"
          className={styles.exitBtn}
          title="返回"
          onClick={() => {
            const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
            if (idx > 0) navigate(-1);
            else if (projects[0]) navigate(`/project/${projects[0].id}`);
          }}
        >
          <Icon name="arrow-left" size={14} />
          <span>返回</span>
        </button>
      </div>
      <div className={styles.welcomeInner}>
        <h1 className={styles.greeting}>{greeting()}</h1>
        <p className={styles.welcomeSub}>选择项目，直接开始你的分析任务。</p>

        <div className={styles.composerCard}>
          <div className={styles.pickerRow}>
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
                          onClick={() => { setSelectedId(p.id); setPickerOpen(false); setPanelSection('none'); }}
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
                          {!folderPath ? (
                            <>
                              <FolderPicker
                                initialPath=""
                                pickLabel="选择此文件夹"
                                onPick={(picked: string) => { setFolderPath(picked); setFolderName(baseName(picked)); }}
                                onCancel={() => setPanelSection('none')}
                              />
                            </>
                          ) : (
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
                          )}
                        </div>
                      ) : panelSection === 'ssh' ? (
                        <div className={styles.actionForm}>
                          <select
                            className={styles.actionInput}
                            value={sshAlias}
                            onChange={(e) => setSshAlias(e.target.value)}
                            aria-label="远程目标"
                          >
                            <option value="">选择已注册目标…</option>
                            {sshTargets.map((t) => (
                              <option key={t.alias} value={t.alias}>{t.alias}（{t.label}）</option>
                            ))}
                          </select>
                          <input
                            className={styles.actionInput}
                            value={sshRemotePath}
                            onChange={(e) => setSshRemotePath(e.target.value)}
                            placeholder="远程路径，如 /root/项目目录"
                            aria-label="远程路径"
                          />
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
                          <button type="button" className={styles.panelAction} onClick={() => setPanelSection('folder')}>
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

          <textarea
            className={styles.composerTextarea}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void launch();
              }
            }}
            placeholder="描述你的分析任务，Enter 发送，Shift+Enter 换行"
            rows={4}
            disabled={!backendReady}
            aria-label="任务描述"
          />

          <div className={styles.composerFoot}>
            {!backendReady && (
              <span className={styles.backendHint}>本地分析服务未就绪，启动后即可发送</span>
            )}
            {error && <span className={styles.errorText} role="alert">{error}</span>}
            <button
              type="button"
              className={styles.sendBtn}
              onClick={() => void launch()}
              disabled={!canSend}
              title="创建会话并启动首个任务"
            >
              <Icon name="send" size={15} />
              {launching ? '启动中…' : '开始任务'}
            </button>
          </div>
        </div>

        <div className={styles.chips} aria-label="快捷任务">
          {QUICK_CHIPS.map((chip) => (
            <button
              key={chip.label}
              type="button"
              className={styles.chip}
              onClick={() => setDraft(chip.prompt)}
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
