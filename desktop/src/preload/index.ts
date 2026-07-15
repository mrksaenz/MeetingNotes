import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AppSettings,
  ExportFormat,
  ExportResult,
  Meeting,
  MeetingListItem,
  ProcessingLevel,
  ProcessingProgress,
} from '@shared/types';

const api = {
  // Settings
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (update: {
    libraryPath?: string;
    assemblyAiKey?: string;
    anthropicKey?: string;
  }): Promise<AppSettings> => ipcRenderer.invoke('settings:save', update),
  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('settings:choose-folder'),

  // Meetings
  listMeetings: (): Promise<MeetingListItem[]> => ipcRenderer.invoke('meetings:list'),
  getMeeting: (id: string): Promise<Meeting> => ipcRenderer.invoke('meetings:get', id),
  createMeeting: (input: {
    title: string;
    recordedAt: string;
    agendaText: string | null;
  }): Promise<Meeting> => ipcRenderer.invoke('meetings:create', input),
  updateMeeting: (
    id: string,
    patch: Partial<Pick<Meeting, 'title' | 'agendaText' | 'speakerLabels' | 'recordedAt'>>
  ): Promise<Meeting> => ipcRenderer.invoke('meetings:update', id, patch),
  deleteMeeting: (id: string): Promise<void> => ipcRenderer.invoke('meetings:delete', id),
  revealMeeting: (id: string): Promise<void> => ipcRenderer.invoke('meetings:reveal', id),

  addAudioPaths: (
    id: string,
    items: Array<{ path: string; durationSeconds: number | null }>
  ): Promise<Meeting> => ipcRenderer.invoke('meetings:add-audio-paths', id, items),
  addRecordedAudio: (
    id: string,
    data: ArrayBuffer,
    mimeType: string,
    durationSeconds: number
  ): Promise<Meeting> =>
    ipcRenderer.invoke('meetings:add-recorded-audio', id, data, mimeType, durationSeconds),
  addManualTranscript: (id: string, raw: string): Promise<Meeting> =>
    ipcRenderer.invoke('meetings:add-manual-transcript', id, raw),

  // File objects from <input type=file> / drag-drop → real filesystem paths
  getFilePath: (file: File): string => webUtils.getPathForFile(file),

  // Processing
  processMeeting: (id: string, level: ProcessingLevel): Promise<Meeting> =>
    ipcRenderer.invoke('process:run', id, level),
  isProcessing: (id: string): Promise<boolean> => ipcRenderer.invoke('process:is-running', id),
  onProcessingProgress: (callback: (p: ProcessingProgress) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: ProcessingProgress) => callback(p);
    ipcRenderer.on('process:progress', listener);
    return () => ipcRenderer.removeListener('process:progress', listener);
  },

  // Export
  exportMeeting: (id: string, format: ExportFormat): Promise<ExportResult> =>
    ipcRenderer.invoke('export:run', id, format),
};

export type Api = typeof api;

contextBridge.exposeInMainWorld('api', api);
