// ============================================================
// DesktopSettingsPanel — Trash management section
//
// Extracted from src/components/desktop/DesktopSettingsPanel.tsx
// by BLOCK-9.2 PHASE 1. Original location: lines 512-653.
//
// Lists archived projects + conversations; restore / permanently delete
// / empty trash. Uses project-store + copilotConversationsClient.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { deleteProject, listProjects, setProjectStatus } from '@/lib/project-store';
import type { Project } from '@/lib/project-types';
import {
  archiveConversation,
  deleteConversation,
  listConversations,
  type ConversationSummary,
} from '@/components/copilot/copilotConversationsClient';

export function TrashManagement(): React.ReactElement {
  const [projects, setProjects] = useState<Project[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadTrash = useCallback(async () => {
    setLoading(true);
    try {
      const [activeProjects, archivedProjects] = await Promise.all([
        listProjects(),
        listProjects(undefined, 'archived'),
      ]);
      const allProjects = [...activeProjects, ...archivedProjects];
      const archivedConversations = await Promise.all(
        allProjects.map((project) => listConversations('archived', project.id))
      );
      setProjects(archivedProjects);
      setConversations(archivedConversations.flat());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTrash();
  }, [loadTrash]);

  const restoreProject = async (projectId: string) => {
    setBusyId(projectId);
    try {
      await setProjectStatus(projectId, 'active');
      await loadTrash();
    } finally {
      setBusyId(null);
    }
  };

  const restoreConversation = async (conversationId: string) => {
    setBusyId(conversationId);
    try {
      await archiveConversation(conversationId, false);
      await loadTrash();
    } finally {
      setBusyId(null);
    }
  };

  const permanentlyDeleteProject = async (projectId: string) => {
    if (!window.confirm('永久删除这个项目记录及其应用内数据？外部工作目录不会被删除。此操作无法撤销。')) return;
    setBusyId(projectId);
    try {
      await deleteProject(projectId);
      await loadTrash();
    } finally {
      setBusyId(null);
    }
  };

  const permanentlyDeleteConversation = async (conversationId: string) => {
    if (!window.confirm('永久删除这个会话及其消息？此操作无法撤销。')) return;
    setBusyId(conversationId);
    try {
      await deleteConversation(conversationId);
      await loadTrash();
    } finally {
      setBusyId(null);
    }
  };

  const emptyTrash = async () => {
    if (projects.length + conversations.length === 0) return;
    if (!window.confirm('永久清空回收站？项目记录、会话和消息将无法恢复；外部工作目录不会被删除。')) return;
    setBusyId('all');
    try {
      // Delete conversations first. Project deletion cascades its remaining
      // conversations, so avoiding concurrent requests keeps the operation
      // deterministic when both appear in the recycle bin.
      for (const conversation of conversations) {
        await deleteConversation(conversation.id);
      }
      for (const project of projects) {
        await deleteProject(project.id);
      }
      await loadTrash();
    } finally {
      setBusyId(null);
    }
  };

  const projectNameById = new Map(
    projects.map((project) => [project.id, project.name])
  );
  const count = projects.length + conversations.length;

  return (
    <div className="gewu-trash-section">
      <div className="gewu-trash-section__header">
        <div>
          <strong>回收站</strong>
          <p>移除的项目和会话会保留在这里，清理后才会永久删除。</p>
        </div>
        <button
          type="button"
          className="gewu-btn gewu-btn--danger-ghost gewu-btn--sm"
          onClick={() => void emptyTrash()}
          disabled={loading || count === 0 || busyId !== null}
        >
          清空回收站{count > 0 ? ` (${count})` : ''}
        </button>
      </div>
      {loading ? (
        <div className="gewu-trash-empty">正在读取回收站…</div>
      ) : count === 0 ? (
        <div className="gewu-trash-empty">回收站为空</div>
      ) : (
        <div className="gewu-trash-list">
          {projects.map((project) => (
            <div key={project.id} className="gewu-trash-item">
              <Icon name="folder" size={14} />
              <div><strong>{project.name}</strong><small>项目</small></div>
              <button className="gewu-btn gewu-btn--ghost gewu-btn--sm" type="button" onClick={() => void restoreProject(project.id)} disabled={busyId !== null}>恢复</button>
              <button type="button" className="danger" onClick={() => void permanentlyDeleteProject(project.id)} disabled={busyId !== null}>永久删除</button>
            </div>
          ))}
          {conversations.map((conversation) => (
            <div key={conversation.id} className="gewu-trash-item">
              <Icon name="message-circle" size={14} />
              <div>
                <strong>{conversation.title}</strong>
                <small>会话{conversation.project_id ? ` · ${projectNameById.get(conversation.project_id) || '现有项目'}` : ''}</small>
              </div>
              <button className="gewu-btn gewu-btn--ghost gewu-btn--sm" type="button" onClick={() => void restoreConversation(conversation.id)} disabled={busyId !== null}>恢复</button>
              <button type="button" className="danger" onClick={() => void permanentlyDeleteConversation(conversation.id)} disabled={busyId !== null}>永久删除</button>
            </div>
          ))}
        </div>
      )}
      <p className="gewu-field__hint">永久清理只删除 Gewu 内的项目记录、会话和关联消息，不会删除你选择的外部工作目录。</p>
    </div>
  );
}
