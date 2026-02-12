/**
 * IndexedDB-based local storage for audio recording blobs.
 * Ensures recordings are persisted locally before upload attempts,
 * so they are never lost due to network or server failures.
 *
 * DB Version 2 adds a `pendingSegments` store for auto-segmented recordings
 * that upload during recording (5-min segments).
 */

export interface PendingRecording {
  id: string;
  audioBlob: Blob;
  mimeType: string;
  durationSeconds: number;
  workspaceId: string;
  meetingId: string | null;
  meetingTitle: string;
  existingMeetingId: string | null;
  partNumber: number;
  userId: string;
  createdAt: string;
  uploadAttempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  status: 'pending' | 'uploading' | 'uploaded';
}

export interface PendingSegment {
  id: string;
  segmentBlob: Blob;
  segmentNumber: number;
  recordingPartId: string;
  meetingId: string;
  partNumber: number;
  userId: string;
  mimeType: string;
  durationSeconds: number;
  createdAt: string;
  uploadAttempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  status: 'pending' | 'uploading' | 'uploaded';
}

const DB_NAME = 'meeting-notes-recordings';
const DB_VERSION = 2;
const STORE_NAME = 'pendingRecordings';
const SEGMENTS_STORE_NAME = 'pendingSegments';

let dbInstance: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('IndexedDB open failed:', request.error);
        resolve(null);
      };

      request.onsuccess = () => {
        dbInstance = request.result;
        dbInstance.onclose = () => { dbInstance = null; };
        resolve(dbInstance);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        // V1: pending recordings store
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('workspaceId', 'workspaceId', { unique: false });
          store.createIndex('status', 'status', { unique: false });
        }
        // V2: pending segments store
        if (!db.objectStoreNames.contains(SEGMENTS_STORE_NAME)) {
          const segStore = db.createObjectStore(SEGMENTS_STORE_NAME, { keyPath: 'id' });
          segStore.createIndex('recordingPartId', 'recordingPartId', { unique: false });
          segStore.createIndex('status', 'status', { unique: false });
        }
      };
    } catch {
      console.error('IndexedDB not available');
      resolve(null);
    }
  });
}

// ============================================================
// Legacy full-recording operations (pendingRecordings store)
// ============================================================

export async function saveRecordingLocally(
  recording: Omit<PendingRecording, 'id' | 'createdAt' | 'uploadAttempts' | 'lastAttemptAt' | 'lastError' | 'status'>
): Promise<string | null> {
  const db = await openDB();
  if (!db) return null;

  const id = crypto.randomUUID();
  const record: PendingRecording = {
    ...recording,
    id,
    createdAt: new Date().toISOString(),
    uploadAttempts: 0,
    lastAttemptAt: null,
    lastError: null,
    status: 'pending',
  };

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(record);

      request.onsuccess = () => resolve(id);
      request.onerror = () => {
        console.error('IndexedDB put failed:', request.error);
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
}

export async function getPendingRecordings(): Promise<PendingRecording[]> {
  const db = await openDB();
  if (!db) return [];

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const all = request.result as PendingRecording[];
        resolve(all.filter((r) => r.status !== 'uploaded'));
      };
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function getPendingRecordingsForWorkspace(
  workspaceId: string
): Promise<PendingRecording[]> {
  const db = await openDB();
  if (!db) return [];

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('workspaceId');
      const request = index.getAll(workspaceId);

      request.onsuccess = () => {
        const results = request.result as PendingRecording[];
        resolve(results.filter((r) => r.status !== 'uploaded'));
      };
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function getRecordingById(id: string): Promise<PendingRecording | null> {
  const db = await openDB();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function updateRecordingStatus(
  id: string,
  updates: Partial<Pick<PendingRecording, 'status' | 'uploadAttempts' | 'lastAttemptAt' | 'lastError' | 'meetingId'>>
): Promise<void> {
  const db = await openDB();
  if (!db) return;

  const existing = await getRecordingById(id);
  if (!existing) return;

  const updated = { ...existing, ...updates };

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(updated);

      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function deleteLocalRecording(id: string): Promise<void> {
  const db = await openDB();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function getRecordingBlob(id: string): Promise<{ blob: Blob; fileName: string } | null> {
  const recording = await getRecordingById(id);
  if (!recording || !recording.audioBlob) return null;

  const ext = recording.mimeType?.includes('webm') ? 'webm' : 'mp4';
  const safeTitle = recording.meetingTitle
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 60);
  const fileName = `${safeTitle}_part${recording.partNumber}.${ext}`;

  return { blob: recording.audioBlob, fileName };
}

export async function getPendingCount(): Promise<number> {
  const pending = await getPendingRecordings();
  return pending.length;
}

// ============================================================
// Segment operations (pendingSegments store)
// ============================================================

export async function saveSegmentLocally(
  segment: Omit<PendingSegment, 'id' | 'createdAt' | 'uploadAttempts' | 'lastAttemptAt' | 'lastError' | 'status'>
): Promise<string | null> {
  const db = await openDB();
  if (!db) return null;

  const id = `${segment.recordingPartId}_seg_${segment.segmentNumber}`;
  const record: PendingSegment = {
    ...segment,
    id,
    createdAt: new Date().toISOString(),
    uploadAttempts: 0,
    lastAttemptAt: null,
    lastError: null,
    status: 'pending',
  };

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(SEGMENTS_STORE_NAME, 'readwrite');
      const store = tx.objectStore(SEGMENTS_STORE_NAME);
      const request = store.put(record);

      request.onsuccess = () => resolve(id);
      request.onerror = () => {
        console.error('IndexedDB segment put failed:', request.error);
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
}

export async function getPendingSegments(): Promise<PendingSegment[]> {
  const db = await openDB();
  if (!db) return [];

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(SEGMENTS_STORE_NAME, 'readonly');
      const store = tx.objectStore(SEGMENTS_STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const all = request.result as PendingSegment[];
        resolve(all.filter((s) => s.status !== 'uploaded'));
      };
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function getPendingSegmentsForPart(
  recordingPartId: string
): Promise<PendingSegment[]> {
  const db = await openDB();
  if (!db) return [];

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(SEGMENTS_STORE_NAME, 'readonly');
      const store = tx.objectStore(SEGMENTS_STORE_NAME);
      const index = store.index('recordingPartId');
      const request = index.getAll(recordingPartId);

      request.onsuccess = () => {
        const results = request.result as PendingSegment[];
        resolve(results.filter((s) => s.status !== 'uploaded'));
      };
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function getSegmentById(id: string): Promise<PendingSegment | null> {
  const db = await openDB();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(SEGMENTS_STORE_NAME, 'readonly');
      const store = tx.objectStore(SEGMENTS_STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function updateSegmentStatus(
  id: string,
  updates: Partial<Pick<PendingSegment, 'status' | 'uploadAttempts' | 'lastAttemptAt' | 'lastError'>>
): Promise<void> {
  const db = await openDB();
  if (!db) return;

  const existing = await getSegmentById(id);
  if (!existing) return;

  const updated = { ...existing, ...updates };

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(SEGMENTS_STORE_NAME, 'readwrite');
      const store = tx.objectStore(SEGMENTS_STORE_NAME);
      const request = store.put(updated);

      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function deleteSegmentLocally(id: string): Promise<void> {
  const db = await openDB();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(SEGMENTS_STORE_NAME, 'readwrite');
      const store = tx.objectStore(SEGMENTS_STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function getPendingSegmentsForRecording(
  meetingId: string,
  partNumber: number,
): Promise<PendingSegment[]> {
  const all = await getPendingSegments();
  return all
    .filter((s) => s.meetingId === meetingId && s.partNumber === partNumber)
    .sort((a, b) => a.segmentNumber - b.segmentNumber);
}

export async function getPendingSegmentCount(): Promise<number> {
  const pending = await getPendingSegments();
  return pending.length;
}
