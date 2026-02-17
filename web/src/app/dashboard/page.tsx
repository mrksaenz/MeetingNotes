'use client';

import { useState, useEffect, useCallback } from 'react';
import Sidebar from '@/components/layout/Sidebar';
import MobileNav from '@/components/layout/MobileNav';
import MobileHeader from '@/components/layout/MobileHeader';
import CreateWorkspaceModal from '@/components/workspace/CreateWorkspaceModal';
import RecordingScreen from '@/components/recording/RecordingScreen';
import MeetingCard from '@/components/meeting/MeetingCard';
import MeetingDetail from '@/components/meeting/MeetingDetail';
import PendingRecordingsBanner from '@/components/recording/PendingRecordingsBanner';
import ImportRecordingModal from '@/components/recording/ImportRecordingModal';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { usePendingUploads } from '@/hooks/usePendingUploads';
import { createClient } from '@/lib/supabase/client';
import type { Workspace, Meeting, RecordingPart } from '@/types/database';
import type { PendingRecording } from '@/lib/recordingStore';
import type { UploadProgressMap } from '@/hooks/usePendingUploads';

interface MeetingWithParts extends Meeting {
  recording_parts: RecordingPart[];
}

export default function DashboardPage() {
  const { workspaces, loading, createWorkspace } = useWorkspaces();
  const {
    pendingRecordings,
    pendingSegmentCount,
    isRetrying,
    uploadProgress,
    retryAll,
    retryOne,
    discardOne,
    saveToDevice,
    exportForTransfer,
    refreshPending,
  } = usePendingUploads();
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null);
  const [activeTab, setActiveTab] = useState<'workspaces' | 'recordings' | 'settings'>('recordings');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [continueMeeting, setContinueMeeting] = useState<MeetingWithParts | null>(null);

  // Meetings state
  const [meetings, setMeetings] = useState<MeetingWithParts[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Meeting detail view
  const [selectedMeeting, setSelectedMeeting] = useState<MeetingWithParts | null>(null);

  const fetchMeetings = useCallback(async (wsId: string) => {
    setMeetingsLoading(true);
    const supabase = createClient();

    // Try with is_archived filter first; fall back without it
    // (migration 002 may not have been run yet)
    let data;
    let error;

    ({ data, error } = await supabase
      .from('meetings')
      .select('*, recording_parts(*)')
      .eq('workspace_id', wsId)
      .eq('is_archived', false)
      .order('recorded_at', { ascending: false }));

    if (error) {
      console.error('Failed to fetch meetings (with is_archived filter):', error.message, error.code);
      // Retry without is_archived filter in case the column doesn't exist
      ({ data, error } = await supabase
        .from('meetings')
        .select('*, recording_parts(*)')
        .eq('workspace_id', wsId)
        .order('recorded_at', { ascending: false }));

      if (error) {
        console.error('Failed to fetch meetings (fallback):', error.message, error.code);
      }
    }

    if (data) {
      const sorted = data.map((m: MeetingWithParts) => ({
        ...m,
        recording_parts: (m.recording_parts || []).sort(
          (a: RecordingPart, b: RecordingPart) => a.part_number - b.part_number
        ),
      }));
      setMeetings(sorted);
    }
    setMeetingsLoading(false);
  }, []);

  // Fetch meetings when workspace changes or after recording completes
  useEffect(() => {
    setSelectedMeeting(null);
    if (selectedWorkspace) {
      fetchMeetings(selectedWorkspace.id);
    } else {
      setMeetings([]);
    }
  }, [selectedWorkspace, fetchMeetings, refreshTrigger]);

  async function handleCreateWorkspace(name: string, color: string) {
    const ws = await createWorkspace(name, color);
    if (ws) {
      setSelectedWorkspace(ws);
      setShowCreateModal(false);
    }
  }

  function handleStartRecording() {
    setContinueMeeting(null);
    setIsRecording(true);
  }

  function handleContinueMeeting(meeting: MeetingWithParts) {
    setContinueMeeting(meeting);
    setIsRecording(true);
  }

  function handleRecordingComplete() {
    setIsRecording(false);
    setContinueMeeting(null);
    refreshPending();
    setRefreshTrigger((prev) => prev + 1);
  }

  function handleRecordingCancel() {
    setIsRecording(false);
    setContinueMeeting(null);
    refreshPending();
  }

  function handleRefreshMeetings() {
    if (selectedWorkspace) {
      fetchMeetings(selectedWorkspace.id);
    }
  }

  async function handleDeleteMeeting(meetingId: string) {
    const supabase = createClient();
    // Find the meeting to get audio file paths for storage cleanup
    const meeting = meetings.find((m) => m.id === meetingId);
    if (!meeting) return;

    // Delete audio files from storage
    const filePaths = meeting.recording_parts
      .map((p) => p.audio_file_path)
      .filter(Boolean);
    if (filePaths.length > 0) {
      await supabase.storage.from('recordings').remove(filePaths);
    }

    // Delete the meeting (cascades to parts, transcriptions, summaries)
    const { error } = await supabase.from('meetings').delete().eq('id', meetingId);
    if (!error) {
      setMeetings((prev) => prev.filter((m) => m.id !== meetingId));
    }
  }

  async function handleArchiveMeeting(meetingId: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from('meetings')
      .update({ is_archived: true })
      .eq('id', meetingId);
    if (!error) {
      setMeetings((prev) => prev.filter((m) => m.id !== meetingId));
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

  // Full-screen recording mode
  if (isRecording && selectedWorkspace) {
    return (
      <RecordingScreen
        workspaceId={selectedWorkspace.id}
        workspaceName={selectedWorkspace.name}
        workspaceColor={selectedWorkspace.color || '#3b82f6'}
        existingMeeting={continueMeeting || undefined}
        existingPartCount={continueMeeting?.recording_parts.length || 0}
        onComplete={handleRecordingComplete}
        onCancel={handleRecordingCancel}
      />
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
            <WorkspaceView
              workspace={selectedWorkspace}
              meetings={meetings}
              meetingsLoading={meetingsLoading}
              pendingRecordings={pendingRecordings.filter(
                (r) => r.workspaceId === selectedWorkspace.id
              )}
              pendingSegmentCount={pendingSegmentCount}
              isRetrying={isRetrying}
              uploadProgress={uploadProgress}
              selectedMeeting={selectedMeeting}
              onRetryAll={retryAll}
              onRetryOne={retryOne}
              onDiscardOne={discardOne}
              onSaveToDevice={saveToDevice}
              onExportForTransfer={exportForTransfer}
              onStartRecording={handleStartRecording}
              onContinueMeeting={handleContinueMeeting}
              onRefreshMeetings={handleRefreshMeetings}
              onDeleteMeeting={handleDeleteMeeting}
              onArchiveMeeting={handleArchiveMeeting}
              onViewDetail={setSelectedMeeting}
              onBackToList={() => setSelectedMeeting(null)}
              onOpenImport={() => setShowImportModal(true)}
            />
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

      {/* Import recording modal */}
      <ImportRecordingModal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImportComplete={() => {
          setShowImportModal(false);
          setRefreshTrigger((prev) => prev + 1);
        }}
        workspaces={workspaces}
        selectedWorkspaceId={selectedWorkspace?.id}
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

function WorkspaceView({
  workspace,
  meetings,
  meetingsLoading,
  pendingRecordings,
  pendingSegmentCount,
  isRetrying,
  uploadProgress,
  selectedMeeting,
  onRetryAll,
  onRetryOne,
  onDiscardOne,
  onSaveToDevice,
  onExportForTransfer,
  onStartRecording,
  onContinueMeeting,
  onRefreshMeetings,
  onDeleteMeeting,
  onArchiveMeeting,
  onViewDetail,
  onBackToList,
  onOpenImport,
}: {
  workspace: Workspace;
  meetings: MeetingWithParts[];
  meetingsLoading: boolean;
  pendingRecordings: PendingRecording[];
  pendingSegmentCount: number;
  isRetrying: boolean;
  uploadProgress: UploadProgressMap;
  selectedMeeting: MeetingWithParts | null;
  onRetryAll: () => Promise<void>;
  onRetryOne: (id: string) => Promise<boolean>;
  onDiscardOne: (id: string) => Promise<void>;
  onSaveToDevice: (id: string) => Promise<boolean>;
  onExportForTransfer: (id: string) => Promise<boolean>;
  onStartRecording: () => void;
  onContinueMeeting: (meeting: MeetingWithParts) => void;
  onRefreshMeetings: () => void;
  onDeleteMeeting: (meetingId: string) => Promise<void>;
  onArchiveMeeting: (meetingId: string) => Promise<void>;
  onViewDetail: (meeting: MeetingWithParts) => void;
  onBackToList: () => void;
  onOpenImport: () => void;
}) {
  // If a meeting is selected, show the detail view
  if (selectedMeeting) {
    // Keep the meeting data fresh from the meetings list
    const freshMeeting = meetings.find((m) => m.id === selectedMeeting.id) || selectedMeeting;
    return (
      <MeetingDetail
        meeting={freshMeeting}
        onBack={onBackToList}
        onRefresh={onRefreshMeetings}
      />
    );
  }

  return (
    <div>
      {/* Workspace header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className="h-4 w-4 rounded-full"
            style={{ backgroundColor: workspace.color || '#3b82f6' }}
          />
          <h1 className="text-xl font-semibold text-foreground">{workspace.name}</h1>
        </div>

        {/* Desktop action buttons */}
        <div className="hidden md:flex items-center gap-2">
          <button
            onClick={onOpenImport}
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-surface transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            Import
          </button>
          <button
            onClick={onStartRecording}
            className="flex items-center gap-2 rounded-lg bg-accent-rose px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:shadow-md active:scale-[0.98]"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="6" />
            </svg>
            Record
          </button>
        </div>
      </div>

      {/* Pending recordings banner */}
      {(pendingRecordings.length > 0 || pendingSegmentCount > 0) && (
        <PendingRecordingsBanner
          pendingRecordings={pendingRecordings}
          pendingSegmentCount={pendingSegmentCount}
          isRetrying={isRetrying}
          uploadProgress={uploadProgress}
          onRetryAll={onRetryAll}
          onRetryOne={onRetryOne}
          onDiscardOne={onDiscardOne}
          onSaveToDevice={onSaveToDevice}
          onExportForTransfer={onExportForTransfer}
        />
      )}

      {/* Meetings list */}
      {meetingsLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3 text-muted">
            <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading meetings...
          </div>
        </div>
      ) : meetings.length > 0 ? (
        <div className="space-y-3">
          {meetings.map((meeting) => (
            <MeetingCard
              key={meeting.id}
              meeting={meeting}
              onContinue={onContinueMeeting}
              onRefresh={onRefreshMeetings}
              onDelete={onDeleteMeeting}
              onArchive={onArchiveMeeting}
              onViewDetail={onViewDetail}
            />
          ))}
        </div>
      ) : (
        /* Empty state */
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
        </div>
      )}

      {/* Floating buttons (mobile) */}
      <div className="fixed bottom-20 right-4 md:hidden z-30 flex flex-col items-center gap-3">
        <button
          onClick={onOpenImport}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-md transition-all hover:shadow-lg active:scale-95"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
        </button>
        <button
          onClick={onStartRecording}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-rose text-white shadow-lg transition-all hover:shadow-xl active:scale-95"
        >
          <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
