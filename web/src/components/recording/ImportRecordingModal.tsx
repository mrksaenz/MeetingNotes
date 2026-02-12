'use client';

import { useState, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { uploadAudio, uploadSegment } from '@/lib/uploadAudio';
import { parseTransferBundle, type TransferManifest } from '@/lib/transferBundle';
import { useToast } from '@/contexts/ToastContext';
import UploadProgressBar from '@/components/ui/UploadProgressBar';
import type { Workspace } from '@/types/database';

type ModalStep = 'select' | 'preview' | 'importing' | 'done';

interface ImportRecordingModalProps {
  open: boolean;
  onClose: () => void;
  onImportComplete: () => void;
  workspaces: Workspace[];
  selectedWorkspaceId?: string;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function ImportRecordingModal({
  open,
  onClose,
  onImportComplete,
  workspaces,
  selectedWorkspaceId,
}: ImportRecordingModalProps) {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<ModalStep>('select');
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parsed bundle data
  const [manifest, setManifest] = useState<TransferManifest | null>(null);
  const [audioBlobs, setAudioBlobs] = useState<Array<{ fileName: string; blob: Blob; segmentNumber?: number }>>([]);

  // Workspace override (if manifest workspace doesn't exist)
  const [workspaceOverride, setWorkspaceOverride] = useState<string | null>(null);
  const [workspaceMissing, setWorkspaceMissing] = useState(false);

  // Import progress
  const [importStatus, setImportStatus] = useState('');
  const [uploadProgress, setUploadProgress] = useState({ bytesUploaded: 0, bytesTotal: 0 });

  function resetState() {
    setStep('select');
    setIsDragging(false);
    setError(null);
    setManifest(null);
    setAudioBlobs([]);
    setWorkspaceOverride(null);
    setWorkspaceMissing(false);
    setImportStatus('');
    setUploadProgress({ bytesUploaded: 0, bytesTotal: 0 });
  }

  function handleClose() {
    resetState();
    onClose();
  }

  const processFile = useCallback(async (file: File) => {
    setError(null);

    if (!file.name.endsWith('.zip') && !file.name.includes('.mntransfer')) {
      setError('Please select a .mntransfer.zip file');
      return;
    }

    try {
      const parsed = await parseTransferBundle(file);

      // Check if the workspace exists
      const wsExists = workspaces.some((ws) => ws.id === parsed.manifest.workspaceId);
      if (!wsExists) {
        setWorkspaceMissing(true);
        setWorkspaceOverride(selectedWorkspaceId || workspaces[0]?.id || null);
      }

      setManifest(parsed.manifest);
      setAudioBlobs(parsed.audioBlobs);
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read transfer file');
    }
  }, [workspaces, selectedWorkspaceId]);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
  }

  async function handleImport() {
    if (!manifest || audioBlobs.length === 0) return;

    setStep('importing');
    setImportStatus('Verifying account...');

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated — please log in');

      // Validate user ID matches
      if (manifest.userId !== user.id) {
        throw new Error('This recording belongs to a different account. Please log in with the same account used on your phone.');
      }

      const targetWorkspaceId = workspaceOverride || manifest.workspaceId;

      // Resolve or create meeting
      setImportStatus('Setting up meeting...');
      let meetingId: string | null = manifest.meetingId || manifest.existingMeetingId;

      if (meetingId) {
        // Check if meeting still exists in DB
        const { data } = await supabase
          .from('meetings')
          .select('id')
          .eq('id', meetingId)
          .single();
        if (!data) meetingId = null;
      }

      if (!meetingId) {
        const { data, error: insertErr } = await supabase
          .from('meetings')
          .insert({
            workspace_id: targetWorkspaceId,
            user_id: user.id,
            title: manifest.meetingTitle,
            recorded_at: manifest.recordedAt,
          })
          .select()
          .single();
        if (insertErr || !data) {
          throw new Error(insertErr?.message || 'Failed to create meeting');
        }
        meetingId = data.id;
      }

      // At this point meetingId is guaranteed to be set
      const resolvedMeetingId: string = meetingId!;

      // Check for duplicate recording_parts
      const { data: existingParts } = await supabase
        .from('recording_parts')
        .select('id')
        .eq('meeting_id', resolvedMeetingId)
        .eq('part_number', manifest.partNumber)
        .limit(1);

      let recordingPartId: string;

      if (existingParts && existingParts.length > 0) {
        recordingPartId = existingParts[0].id;
      } else {
        // Create recording_parts row (audio_file_path will be updated after upload)
        const { data: partData, error: partErr } = await supabase
          .from('recording_parts')
          .insert({
            meeting_id: resolvedMeetingId,
            part_number: manifest.partNumber,
            audio_file_path: '',
            duration_seconds: manifest.durationSeconds,
            recorded_at: manifest.recordedAt,
            segment_count: manifest.type === 'segmented' ? audioBlobs.length : null,
          })
          .select()
          .single();
        if (partErr || !partData) {
          throw new Error(partErr?.message || 'Failed to create recording part');
        }
        recordingPartId = partData.id;
      }

      // Upload audio file(s)
      setImportStatus('Uploading audio...');

      if (manifest.type === 'single' || audioBlobs.length === 1) {
        // Single file upload
        const audioBlob = audioBlobs[0].blob;
        const totalBytes = audioBlob.size;
        setUploadProgress({ bytesUploaded: 0, bytesTotal: totalBytes });

        const upload = uploadAudio(user.id, resolvedMeetingId, manifest.partNumber, audioBlob, {
          onProgress: (bytesUploaded, bytesTotal) => {
            setUploadProgress({ bytesUploaded, bytesTotal });
          },
        });

        const filePath = await upload.promise;

        // Update recording_parts with the file path
        await supabase
          .from('recording_parts')
          .update({ audio_file_path: filePath })
          .eq('id', recordingPartId);
      } else {
        // Segmented upload — upload each segment
        let totalBytes = 0;
        let uploadedBytes = 0;
        for (const ab of audioBlobs) totalBytes += ab.blob.size;
        setUploadProgress({ bytesUploaded: 0, bytesTotal: totalBytes });

        for (const audioEntry of audioBlobs) {
          const segNum = audioEntry.segmentNumber ?? 0;
          const segBlob = audioEntry.blob;

          const upload = uploadSegment(
            user.id,
            resolvedMeetingId,
            manifest.partNumber,
            segNum,
            segBlob,
            {
              onProgress: (bytesUp, bytesT) => {
                setUploadProgress({
                  bytesUploaded: uploadedBytes + bytesUp,
                  bytesTotal: totalBytes,
                });
              },
            },
          );

          const filePath = await upload.promise;
          uploadedBytes += segBlob.size;
          setUploadProgress({ bytesUploaded: uploadedBytes, bytesTotal: totalBytes });

          // Create recording_segments row
          await supabase.from('recording_segments').upsert(
            {
              recording_part_id: recordingPartId,
              segment_number: segNum,
              audio_file_path: filePath,
              duration_seconds: manifest.audioFiles.find((f) => f.segmentNumber === segNum)?.durationSeconds ?? 0,
              byte_size: segBlob.size,
              upload_status: 'uploaded',
              uploaded_at: new Date().toISOString(),
            },
            { onConflict: 'recording_part_id,segment_number' },
          );
        }
      }

      setImportStatus('Done!');
      setStep('done');
      showToast({ message: 'Recording imported successfully', type: 'success' });

      // Auto-close after brief delay
      setTimeout(() => {
        onImportComplete();
        handleClose();
      }, 1500);
    } catch (err) {
      console.error('Import failed:', err);
      setError(err instanceof Error ? err.message : 'Import failed');
      setStep('preview'); // Go back to preview so user can retry
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40" onClick={handleClose} />

      {/* Modal */}
      <div className="relative w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-xl">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            {step === 'done' ? 'Import Complete' : 'Import Recording'}
          </h2>
          <button
            onClick={handleClose}
            className="rounded-lg p-1 text-muted hover:text-foreground transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-4 rounded-lg bg-accent-rose/10 border border-accent-rose/20 px-3 py-2 text-sm text-accent-rose">
            {error}
          </div>
        )}

        {/* Step 1: File Selection */}
        {step === 'select' && (
          <div>
            <p className="mb-4 text-sm text-muted">
              Select a .mntransfer.zip file exported from your phone.
            </p>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition-colors ${
                isDragging
                  ? 'border-primary-400 bg-primary-50'
                  : 'border-border hover:border-primary-300 hover:bg-primary-50/50'
              }`}
            >
              <svg className="mb-3 h-10 w-10 text-muted" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <p className="text-sm font-medium text-foreground">
                {isDragging ? 'Drop file here' : 'Drag & drop transfer file'}
              </p>
              <p className="mt-1 text-xs text-muted">or click to browse</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          </div>
        )}

        {/* Step 2: Preview */}
        {step === 'preview' && manifest && (
          <div>
            <div className="space-y-3 rounded-lg bg-surface p-4">
              <div>
                <p className="text-xs text-muted">Meeting</p>
                <p className="text-sm font-medium text-foreground">{manifest.meetingTitle}</p>
              </div>
              <div className="flex gap-6">
                <div>
                  <p className="text-xs text-muted">Part</p>
                  <p className="text-sm text-foreground">{manifest.partNumber}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Duration</p>
                  <p className="text-sm text-foreground">{formatDuration(manifest.durationSeconds)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Files</p>
                  <p className="text-sm text-foreground">{manifest.audioFiles.length}</p>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted">Recorded</p>
                <p className="text-sm text-foreground">{formatDate(manifest.recordedAt)}</p>
              </div>
              {manifest.workspaceName && (
                <div>
                  <p className="text-xs text-muted">Workspace</p>
                  <p className="text-sm text-foreground">{manifest.workspaceName}</p>
                </div>
              )}
            </div>

            {/* Workspace mismatch warning */}
            {workspaceMissing && (
              <div className="mt-3 rounded-lg bg-accent-amber/10 border border-accent-amber/20 p-3">
                <p className="text-xs font-medium text-accent-amber mb-2">
                  Original workspace not found on this device
                </p>
                <label className="block text-xs text-muted mb-1">Import to workspace:</label>
                <select
                  value={workspaceOverride || ''}
                  onChange={(e) => setWorkspaceOverride(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
                >
                  {workspaces.map((ws) => (
                    <option key={ws.id} value={ws.id}>{ws.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Actions */}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => { resetState(); }}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-surface transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
              >
                Import
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Importing */}
        {step === 'importing' && (
          <div className="py-4">
            <div className="mb-4 flex items-center gap-3">
              <svg className="h-5 w-5 animate-spin text-primary-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-sm text-foreground">{importStatus}</p>
            </div>
            {uploadProgress.bytesTotal > 0 && (
              <UploadProgressBar
                bytesUploaded={uploadProgress.bytesUploaded}
                bytesTotal={uploadProgress.bytesTotal}
                label="Uploading audio..."
              />
            )}
          </div>
        )}

        {/* Step 4: Done */}
        {step === 'done' && (
          <div className="flex flex-col items-center py-6">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
              <svg className="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <p className="text-sm font-medium text-foreground">Recording imported</p>
            <p className="mt-1 text-xs text-muted">You can now process it with AI</p>
          </div>
        )}
      </div>
    </div>
  );
}
