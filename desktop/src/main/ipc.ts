import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { ExportFormat, Meeting, ProcessingLevel } from '@shared/types';
import * as settings from './settings';
import * as library from './library';
import { runProcessing, isProcessing } from './processing';
import { exportMeeting } from './exporter';

export function registerIpc(): void {
  // ── Settings ──────────────────────────────────────────────────────────
  ipcMain.handle('settings:get', () => settings.getSettings());
  ipcMain.handle('settings:save', (_e, update) => settings.saveSettings(update));

  ipcMain.handle('settings:choose-folder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const result = await dialog.showOpenDialog(win!, {
      title: 'Choose your meetings folder',
      message:
        'Pick the folder where meetings will be stored. Choose a folder inside Google Drive to sync automatically.',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // ── Meetings ──────────────────────────────────────────────────────────
  ipcMain.handle('meetings:list', () => library.listMeetings());
  ipcMain.handle('meetings:get', (_e, id: string) => library.getMeeting(id));
  ipcMain.handle('meetings:create', (_e, input) => library.createMeeting(input));
  ipcMain.handle('meetings:update', (_e, id: string, patch: Partial<Meeting>) =>
    library.updateMeeting(id, patch)
  );
  ipcMain.handle('meetings:delete', (_e, id: string) => library.deleteMeeting(id));
  ipcMain.handle('meetings:reveal', (_e, id: string) => library.revealMeeting(id));

  ipcMain.handle(
    'meetings:add-audio-paths',
    async (_e, id: string, items: Array<{ path: string; durationSeconds: number | null }>) => {
      let meeting: Meeting | null = null;
      for (const item of items) {
        meeting = await library.addAudioFromPath(id, item.path, item.durationSeconds);
      }
      return meeting ?? library.getMeeting(id);
    }
  );

  ipcMain.handle(
    'meetings:add-recorded-audio',
    (_e, id: string, data: ArrayBuffer, mimeType: string, durationSeconds: number) =>
      library.addRecordedAudio(id, data, mimeType, durationSeconds)
  );

  ipcMain.handle('meetings:add-manual-transcript', (_e, id: string, raw: string) =>
    library.addManualTranscript(id, raw)
  );

  // ── Processing ────────────────────────────────────────────────────────
  ipcMain.handle('process:run', (e, id: string, level: ProcessingLevel) => {
    const sender = e.sender;
    return runProcessing(id, level, (progress) => {
      if (!sender.isDestroyed()) sender.send('process:progress', progress);
    });
  });
  ipcMain.handle('process:is-running', (_e, id: string) => isProcessing(id));

  // ── Export ────────────────────────────────────────────────────────────
  ipcMain.handle('export:run', async (_e, id: string, format: ExportFormat) => {
    const result = await exportMeeting(id, format);
    shell.showItemInFolder(result.path);
    return result;
  });
}
