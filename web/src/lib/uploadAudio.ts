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

const CHUNK_SIZE = 6 * 1024 * 1024; // 6 MB per chunk

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

  const promise = new Promise<string | null>(async (resolve) => {
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.error('Upload error: no active session');
        resolve(null);
        return;
      }

      if (aborted) {
        resolve(null);
        return;
      }

      uploadInstance = new tus.Upload(audioBlob, {
        endpoint: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        chunkSize: CHUNK_SIZE,
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        headers: {
          authorization: `Bearer ${session.access_token}`,
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
          resolve(null);
        },
        onProgress: (bytesUploaded, bytesTotal) => {
          options?.onProgress?.(bytesUploaded, bytesTotal);
        },
        onSuccess: () => {
          resolve(fileName);
        },
      });

      // Check for previous uploads to resume from
      const previousUploads = await uploadInstance.findPreviousUploads();
      if (previousUploads.length > 0) {
        uploadInstance.resumeFromPreviousUpload(previousUploads[0]);
      }

      uploadInstance.start();
    } catch (err) {
      console.error('Upload error:', err);
      resolve(null);
    }
  });

  return {
    promise,
    abort: () => {
      aborted = true;
      uploadInstance?.abort();
    },
  };
}
