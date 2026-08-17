// ============================================================
// BranchTabsWrapper — Container component that integrates BranchTabs with branch store
//
// Phase 1: Branch Tab UI
// Gets projectId from URL params and connects to the branch store.
// Renders BranchTabs with branch state and actions.
// ============================================================

import React from 'react';
import { useParams } from 'react-router-dom';
import { BranchTabs } from './BranchTabs';
import { useBranchStore } from '@/hooks/useBranchStore';

export function BranchTabsWrapper(): React.ReactElement | null {
  const { projectId } = useParams<{ projectId: string }>();

  const {
    branches,
    activeBranchId,
    loading,
    createBranch,
    switchBranch,
    renameBranch,
    deleteBranch,
  } = useBranchStore(projectId);

  // Don't render if no projectId or no branches
  if (!projectId || (branches.length === 0 && !loading)) {
    return <></>;
  }

  return (
    <BranchTabs
      branches={branches}
      activeBranchId={activeBranchId}
      onSwitch={switchBranch}
      onCreate={createBranch}
      onRename={renameBranch}
      onDelete={deleteBranch}
      loading={loading}
    />
  );
}
