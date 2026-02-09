/**
 * IndexedDB-based local storage for audio recording blobs.
 * Ensures recordings are persisted locally before upload attempts,
 * so they are never lost due to network or server failures.
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

const DB_NAME = 'meeting-notes-recordings';
const DB_VERSION = 1;
const STORE_NAME = 'pendingRecordings';

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
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('workspaceId', 'workspaceId', { unique: false });
          store.createIndex('status', 'status', { unique: false });
        }
      };
    } catch {
      console.error('IndexedDB not available');
      resolve(null);
    }
  });
}

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

export async function getPendingCount(): Promise<number> {
  const pending = await getPendingRecordings();
  return pending.length;
}
