/**
 * Transfer bundle creation and parsing for offline meeting transfer.
 *
 * Export: Bundles audio blob(s) + metadata into a .mntransfer.zip file
 * that can be AirDropped / transferred to another device.
 *
 * Import: Parses the zip, extracts manifest + audio blobs so they can
 * be uploaded to Supabase Storage from a device with a better connection.
 */

import { zipSync, unzipSync } from 'fflate';
import type { PendingRecording, PendingSegment } from '@/lib/recordingStore';

export interface TransferManifest {
  version: 1;
  exportedAt: string;
  app: 'meeting-notes';
  userId: string;
  meetingTitle: string;
  workspaceId: string;
  workspaceName?: string;
  meetingId: string | null;
  existingMeetingId: string | null;
  recordedAt: string;
  partNumber: number;
  durationSeconds: number;
  mimeType: string;
  type: 'single' | 'segmented';
  audioFiles: Array<{
    fileName: string;
    segmentNumber?: number;
    durationSeconds: number;
    byteSize: number;
  }>;
}

export interface TransferBundleResult {
  blob: Blob;
  fileName: string;
}

export interface ParsedTransferBundle {
  manifest: TransferManifest;
  audioBlobs: Array<{
    fileName: string;
    blob: Blob;
    segmentNumber?: number;
  }>;
}

function sanitizeFileName(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 60);
}

function getFileExtension(mimeType: string): string {
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('mp3') || mimeType.includes('mpeg')) return 'mp3';
  return 'webm';
}

async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

function uint8ArrayToBlob(data: Uint8Array, type: string): Blob {
  const buf = new ArrayBuffer(data.byteLength);
  new Uint8Array(buf).set(data);
  return new Blob([buf], { type });
}

/**
 * Creates a .mntransfer.zip bundle from a pending recording and its segments.
 */
export async function createTransferBundle(
  recording: PendingRecording,
  segments?: PendingSegment[],
  workspaceName?: string,
): Promise<TransferBundleResult> {
  const hasSegments = segments && segments.length > 0;
  const ext = getFileExtension(recording.mimeType);

  const audioFiles: TransferManifest['audioFiles'] = [];
  const zipEntries: Record<string, Uint8Array> = {};

  if (hasSegments) {
    // Bundle each segment as a separate file
    for (const seg of segments) {
      const fileName = `audio/seg_${seg.segmentNumber}.${ext}`;
      const data = await blobToUint8Array(seg.segmentBlob);
      zipEntries[fileName] = data;
      audioFiles.push({
        fileName,
        segmentNumber: seg.segmentNumber,
        durationSeconds: seg.durationSeconds,
        byteSize: data.byteLength,
      });
    }

    // Also include the main recording blob if it has audio data
    if (recording.audioBlob && recording.audioBlob.size > 0) {
      const mainFileName = `audio/part_${recording.partNumber}.${ext}`;
      const mainData = await blobToUint8Array(recording.audioBlob);
      zipEntries[mainFileName] = mainData;
      audioFiles.push({
        fileName: mainFileName,
        durationSeconds: recording.durationSeconds,
        byteSize: mainData.byteLength,
      });
    }
  } else {
    // Single file — the full recording blob
    const fileName = `audio/part_${recording.partNumber}.${ext}`;
    const data = await blobToUint8Array(recording.audioBlob);
    zipEntries[fileName] = data;
    audioFiles.push({
      fileName,
      durationSeconds: recording.durationSeconds,
      byteSize: data.byteLength,
    });
  }

  const manifest: TransferManifest = {
    version: 1,
    exportedAt: new Date().toISOString(),
    app: 'meeting-notes',
    userId: recording.userId,
    meetingTitle: recording.meetingTitle,
    workspaceId: recording.workspaceId,
    workspaceName,
    meetingId: recording.meetingId,
    existingMeetingId: recording.existingMeetingId,
    recordedAt: recording.createdAt,
    partNumber: recording.partNumber,
    durationSeconds: recording.durationSeconds,
    mimeType: recording.mimeType,
    type: hasSegments ? 'segmented' : 'single',
    audioFiles,
  };

  const manifestJson = JSON.stringify(manifest, null, 2);
  const encoder = new TextEncoder();
  zipEntries['manifest.json'] = encoder.encode(manifestJson);

  // Create the zip (fflate.zipSync is synchronous but fast for this size)
  const zipped = zipSync(zipEntries, { level: 0 }); // level 0 = store only (audio is already compressed)

  const blob = uint8ArrayToBlob(zipped, 'application/zip');

  const dateStr = new Date(recording.createdAt).toISOString().split('T')[0];
  const safeName = sanitizeFileName(recording.meetingTitle) || 'Recording';
  const fileName = `${safeName}_${dateStr}.mntransfer.zip`;

  return { blob, fileName };
}

/**
 * Parses a .mntransfer.zip file and extracts manifest + audio blobs.
 */
export async function parseTransferBundle(file: File): Promise<ParsedTransferBundle> {
  const buffer = await file.arrayBuffer();
  const unzipped = unzipSync(new Uint8Array(buffer));

  // Extract and validate manifest
  const manifestBytes = unzipped['manifest.json'];
  if (!manifestBytes) {
    throw new Error('Invalid transfer file: missing manifest.json');
  }

  const decoder = new TextDecoder();
  const manifest: TransferManifest = JSON.parse(decoder.decode(manifestBytes));

  if (manifest.app !== 'meeting-notes') {
    throw new Error('Invalid transfer file: not a Meeting Notes bundle');
  }
  if (manifest.version !== 1) {
    throw new Error(`Unsupported transfer file version: ${manifest.version}`);
  }
  if (!manifest.userId || !manifest.workspaceId || !manifest.audioFiles?.length) {
    throw new Error('Invalid transfer file: missing required metadata');
  }

  // Extract audio blobs
  const audioBlobs: ParsedTransferBundle['audioBlobs'] = [];
  for (const audioFile of manifest.audioFiles) {
    const data = unzipped[audioFile.fileName];
    if (!data) {
      throw new Error(`Invalid transfer file: missing audio file ${audioFile.fileName}`);
    }
    audioBlobs.push({
      fileName: audioFile.fileName,
      blob: uint8ArrayToBlob(data, manifest.mimeType),
      segmentNumber: audioFile.segmentNumber,
    });
  }

  return { manifest, audioBlobs };
}
