'use client';

import { useState } from 'react';
import Sidebar from '@/components/layout/Sidebar';
import MobileNav from '@/components/layout/MobileNav';
import MobileHeader from '@/components/layout/MobileHeader';
import CreateWorkspaceModal from '@/components/workspace/CreateWorkspaceModal';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import type { Workspace } from '@/types/database';

export default function DashboardPage() {
  const { workspaces, loading, createWorkspace } = useWorkspaces();
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null);
  const [activeTab, setActiveTab] = useState<'workspaces' | 'recordings' | 'settings'>('recordings');
  const [showCreateModal, setShowCreateModal] = useState(false);

  async function handleCreateWorkspace(name: string, color: string) {
    const ws = await createWorkspace(name, color);
    if (ws) {
      setSelectedWorkspace(ws);
      setShowCreateModal(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-muted">
          <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <Sidebar
        workspaces={workspaces}
        selectedWorkspace={selectedWorkspace}
        onSelectWorkspace={setSelectedWorkspace}
        onCreateWorkspace={handleCreateWorkspace}
      />

      {/* Main content */}
      <div className="flex flex-1 flex-col">
        {/* Mobile header */}
        <MobileHeader
          workspaces={workspaces}
          selectedWorkspace={selectedWorkspace}
          onSelectWorkspace={setSelectedWorkspace}
          onCreateWorkspace={() => setShowCreateModal(true)}
        />

        {/* Content area */}
        <main className="flex-1 p-4 md:p-8 pb-20 md:pb-8">
          {!selectedWorkspace ? (
            <EmptyState
              hasWorkspaces={workspaces.length > 0}
              onCreateWorkspace={() => setShowCreateModal(true)}
            />
          ) : (
            <WorkspaceView workspace={selectedWorkspace} />
          )}
        </main>

        {/* Mobile bottom nav */}
        <MobileNav activeTab={activeTab} onChangeTab={setActiveTab} />
      </div>

      {/* Create workspace modal */}
      <CreateWorkspaceModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={handleCreateWorkspace}
      />
    </div>
  );
}

function EmptyState({
  hasWorkspaces,
  onCreateWorkspace,
}: {
  hasWorkspaces: boolean;
  onCreateWorkspace: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-50">
        <svg className="h-8 w-8 text-primary-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          {hasWorkspaces ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          )}
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-foreground">
        {hasWorkspaces ? 'Select a workspace' : 'Create your first workspace'}
      </h2>
      <p className="mt-1 max-w-sm text-sm text-muted">
        {hasWorkspaces
          ? 'Choose a workspace from the sidebar to view and manage your recordings.'
          : 'Workspaces help you organize meetings by context — one for each organization you work with.'}
      </p>
      {!hasWorkspaces && (
        <button
          onClick={onCreateWorkspace}
          className="mt-6 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-700"
        >
          Create workspace
        </button>
      )}
    </div>
  );
}

function WorkspaceView({ workspace }: { workspace: Workspace }) {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className="h-4 w-4 rounded-full"
            style={{ backgroundColor: workspace.color || '#3b82f6' }}
          />
          <h1 className="text-xl font-semibold text-foreground">{workspace.name}</h1>
        </div>
      </div>

      {/* Empty recordings state */}
      <div className="flex flex-col items-center py-16 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary-50">
          <svg className="h-8 w-8 text-primary-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-foreground">No recordings yet</h3>
        <p className="mt-1 max-w-xs text-sm text-muted">
          Tap the record button to capture your first meeting in this workspace.
        </p>
        <button className="mt-6 flex items-center gap-2 rounded-full bg-accent-rose px-6 py-3 text-sm font-medium text-white shadow-lg transition-all hover:shadow-xl active:scale-95">
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="8" />
          </svg>
          Record
        </button>
      </div>
    </div>
  );
}
