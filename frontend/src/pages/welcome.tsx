import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { useBackendStatus } from '@/components/backend/BackendStatusProvider';
import { listProjects } from '@/lib/project-store';
import type { Project } from '@/lib/project-types';
import { createConversation } from '@/components/copilot/copilotConversationsClient';
import { branchApi } from '@/lib/branchBridge';
import styles from './welcome.module.css';

/**
 * BLOCK-80 — 欢迎页（ZCode 形态、本项目内容）：时段问候 + 项目/分支选择 +
 * 首问输入框 + 领域快捷 chips。发送 = 创建会话 → sessionStorage 交接首问 →
 * 导航项目工作区由工作区派发 copilotAsk 启动。
 *
 * 项目创建流（本地/手输/SSH/空白）整体在 /projects「项目管理」（原工作台），
 * 本页下拉尾部「管理项目 / 新建项目…」可达。
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

  function manageProjects() {
    navigate('/projects');
  }

  return (
    <div className={styles.welcome} aria-label="欢迎页">
      <div className={styles.welcomeInner}>
        <h1 className={styles.greeting}>{greeting()}</h1>
        <p className={styles.welcomeSub}>选择项目，直接开始你的分析任务。</p>

        <div className={styles.composerCard}>
          <div className={styles.pickerRow}>
            <label className={styles.pickerLabel}>
              <Icon name="folder" size={14} />
              {loaded && projects.length > 0 ? (
                <select
                  className={styles.projectSelect}
                  value={selectedId}
                  onChange={(e) => {
                    if (e.target.value === '__manage__') { navigate('/projects'); return; }
                    setSelectedId(e.target.value);
                  }}
                  aria-label="选择项目"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                  <option value="__manage__">管理项目 / 新建项目…</option>
                </select>
              ) : (
                <span className={styles.pickerEmpty}>
                  {loaded ? '暂无项目' : '项目加载中…'}
                </span>
              )}
            </label>
            {branchName && (
              <span className={styles.branchChip} title="当前分支（切换分支请到审阅面）">
                <Icon name="git-branch" size={13} /> {branchName}
              </span>
            )}
            <button
              type="button"
              className={styles.manageLink}
              onClick={manageProjects}
              title="项目列表与创建（本地目录 / 手动路径 / SSH 远程 / 空白项目）"
            >
              管理项目…
            </button>
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
