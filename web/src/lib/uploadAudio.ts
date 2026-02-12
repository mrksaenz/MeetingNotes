import * as tus from 'tus-js-client';
import { createClient } from '@/lib/supabase/client';

export interface UploadHandle {
  /** Resolves with the file path on success, null on failure */
  promise: Promise<string | null>;
  /** Abort the in-flight upload */
  abort: () => void;
}

export interface UploadOptions {
  onProgress?: (bytesUploaded: number, bytesTotal: number) => void;
}

const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB per chunk (smaller for mobile reliability)

async function getAccessToken(): Promise<string | null> {
  const supabase = createClient();
  // Use refreshSession to ensure we have a fresh token (critical after long recordings)
  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session) {
    // Fall back to getSession if refresh fails
    const { data: sessionData } = await supabase.auth.getSession();
    return sessionData.session?.access_token || null;
  }
  return data.session.access_token;
}

function createTusUpload(
  audioBlob: Blob,
  fileName: string,
  accessToken: string,
  options?: UploadOptions,
): { upload: tus.Upload; promise: Promise<string | null> } {
  let resolvePromise: (value: string | null) => void;
  const promise = new Promise<string | null>((resolve) => {
    resolvePromise = resolve;
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
      resolvePromise(null);
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

  const promise = (async (): Promise<string | null> => {
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        console.error('Upload error: no active session');
        return null;
      }

      if (aborted) return null;

      const { upload, promise: uploadPromise } = createTusUpload(audioBlob, fileName, accessToken, options);
      uploadInstance = upload;

      // Check for previous uploads to resume from
      const previousUploads = await upload.findPreviousUploads();
      if (previousUploads.length > 0) {
        upload.resumeFromPreviousUpload(previousUploads[0]);
      }

      upload.start();
      return uploadPromise;
    } catch (err) {
      console.error('Upload error:', err);
      return null;
    }
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

  const promise = (async (): Promise<string | null> => {
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        console.error('Upload error: no active session');
        return null;
      }

      if (aborted) return null;

      const { upload, promise: uploadPromise } = createTusUpload(audioBlob, fileName, accessToken, options);
      uploadInstance = upload;

      // Check for previous uploads to resume from
      const previousUploads = await upload.findPreviousUploads();
      if (previousUploads.length > 0) {
        upload.resumeFromPreviousUpload(previousUploads[0]);
      }

      upload.start();
      return uploadPromise;
    } catch (err) {
      console.error('Upload error:', err);
      return null;
    }
  })();

  return {
    promise,
    abort: () => {
      aborted = true;
      uploadInstance?.abort();
    },
  };
}
