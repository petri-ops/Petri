// ============================================================
// Branch domain types — Phase 1 Branch UI
//
// Represents the conversation branch model:
//   - Project: workspace containing shared results
//   - Branch: isolated conversation history, shared results
//   - Message: conversation record within a branch
// ============================================================

export interface Branch {
  id: string;
  projectId: string;
  name: string;
  parentBranchId: string | null;
  createdAt: number;
  updatedAt: number;
  isActive: boolean;
}

export interface Message {
  id: string;
  branchId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}
