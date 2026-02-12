import * as tus from 'tus-js-client';
import { createClient } from '@/lib/supabase/client';

export interface UploadHandle {
  /** Resolves with the file path on success, rejects on failure */
  promise: Promise<string>;
  /** Abort the in-flight upload */
  abort: () => void;
}

export interface UploadOptions {
  onProgress?: (bytesUploaded: number, bytesTotal: number) => void;
}

const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB per chunk (smaller for mobile reliability)
const FINGERPRINT_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

async function getAccessToken(): Promise<string> {
  const supabase = createClient();
  // Use refreshSession to ensure we have a fresh token (critical after long recordings)
  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session) {
    // Fall back to getSession if refresh fails
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.access_token) {
      throw new Error('Session expired — please log out and log back in');
    }
    return sessionData.session.access_token;
  }
  return data.session.access_token;
}

function createTusUpload(
  audioBlob: Blob,
  fileName: string,
  accessToken: string,
  options?: UploadOptions,
): { upload: tus.Upload; promise: Promise<string> } {
  let resolvePromise: (value: string) => void;
  let rejectPromise: (error: Error) => void;
  const promise = new Promise<string>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const upload = new tus.Upload(audioBlob, {
    endpoint: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`,
    retryDelays: [0, 3000, 5000, 10000, 20000],
    chunkSize: CHUNK_SIZE,
    uploadDataDuringCreation: true,
    removeFingerprintOnSuccess: true,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'x-upsert': 'true',
    },
    metadata: {
      bucketName: 'recordings',
      objectName: fileName,
      contentType: audioBlob.type,
      cacheControl: '3600',
    },
    onError: (error) => {
      console.error('Upload error:', error);
      let message = error.message || 'Upload failed';
      if (message.length > 200) {
        message = message.substring(0, 200) + '...';
      }
      rejectPromise(new Error(message));
    },
    onProgress: (bytesUploaded, bytesTotal) => {
      options?.onProgress?.(bytesUploaded, bytesTotal);
    },
    onSuccess: () => {
      resolvePromise(fileName);
    },
  });

  return { upload, promise };
}

/**
 * Resume from a previous tus upload only if the fingerprint is recent.
 * Stale fingerprints (from prior attempts with expired auth tokens) cause
 * immediate 0% failures when trying to resume.
 */
async function resumeIfFresh(upload: tus.Upload): Promise<void> {
  const previousUploads = await upload.findPreviousUploads();
  if (previousUploads.length > 0) {
    const prev = previousUploads[0];
    const createdAt = new Date(prev.creationTime).getTime();
    if (Date.now() - createdAt < FINGERPRINT_MAX_AGE_MS) {
      upload.resumeFromPreviousUpload(prev);
    } else {
      console.warn('Skipping stale tus fingerprint from', prev.creationTime);
    }
  }
}

export function uploadAudio(
  userId: string,
  meetingId: string,
  partNumber: number,
  audioBlob: Blob,
  options?: UploadOptions,
): UploadHandle {
  let uploadInstance: tus.Upload | null = null;
  let aborted = false;

  const ext = audioBlob.type.includes('webm') ? 'webm' : 'mp4';
  const fileName = `${userId}/${meetingId}/part_${partNumber}.${ext}`;

  const promise = (async (): Promise<string> => {
    const accessToken = await getAccessToken();

    if (aborted) throw new Error('Upload aborted');

    const { upload, promise: uploadPromise } = createTusUpload(audioBlob, fileName, accessToken, options);
    uploadInstance = upload;

    await resumeIfFresh(upload);

    upload.start();
    return uploadPromise;
  })();

  return {
    promise,
    abort: () => {
      aborted = true;
      uploadInstance?.abort();
    },
  };
}

export function uploadSegment(
  userId: string,
  meetingId: string,
  partNumber: number,
  segmentNumber: number,
  audioBlob: Blob,
  options?: UploadOptions,
): UploadHandle {
  let uploadInstance: tus.Upload | null = null;
  let aborted = false;

  const ext = audioBlob.type.includes('webm') ? 'webm' : 'mp4';
  const fileName = `${userId}/${meetingId}/part_${partNumber}_seg_${segmentNumber}.${ext}`;

  const promise = (async (): Promise<string> => {
    const accessToken = await getAccessToken();

    if (aborted) throw new Error('Upload aborted');

    const { upload, promise: uploadPromise } = createTusUpload(audioBlob, fileName, accessToken, options);
    uploadInstance = upload;

    await resumeIfFresh(upload);

    upload.start();
    return uploadPromise;
  })();

  return {
    promise,
    abort: () => {
      aborted = true;
      uploadInstance?.abort();
    },
  };
}
