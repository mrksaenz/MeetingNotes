import { useState } from 'react';
import type { AppSettings } from '@shared/types';
import { useToast } from '../lib/toast';

/**
 * Shared form used by both first-run setup and the Settings screen.
 * Keys are write-only: the app never sends stored keys back to the UI,
 * it only reports whether one is saved.
 */
export default function SettingsForm({
  settings,
  onSaved,
  submitLabel,
}: {
  settings: AppSettings | null;
  onSaved: () => void;
  submitLabel: string;
}) {
  const toast = useToast();
  const [libraryPath, setLibraryPath] = useState(settings?.libraryPath ?? '');
  const [assemblyAiKey, setAssemblyAiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [saving, setSaving] = useState(false);

  async function chooseFolder() {
    const folder = await window.api.chooseFolder();
    if (folder) setLibraryPath(folder);
  }

  async function save() {
    if (!libraryPath) {
      toast('error', 'Choose a meetings folder first');
      return;
    }
    if (!settings?.hasAssemblyAiKey && !assemblyAiKey.trim()) {
      toast('error', 'Enter the AssemblyAI API key');
      return;
    }
    if (!settings?.hasAnthropicKey && !anthropicKey.trim()) {
      toast('error', 'Enter the Anthropic API key');
      return;
    }
    setSaving(true);
    try {
      await window.api.saveSettings({
        libraryPath,
        ...(assemblyAiKey.trim() ? { assemblyAiKey: assemblyAiKey.trim() } : {}),
        ...(anthropicKey.trim() ? { anthropicKey: anthropicKey.trim() } : {}),
      });
      toast('success', 'Settings saved');
      onSaved();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-slate-700">
          Meetings folder
        </label>
        <p className="mb-2 text-xs text-slate-500">
          All meetings, transcripts, and PDFs are stored here as regular files. Pick a folder
          inside <span className="font-medium">Google Drive</span> and everything syncs
          automatically — the next secretary just points the app at the same folder.
        </p>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            {libraryPath || 'No folder selected'}
          </div>
          <button
            onClick={chooseFolder}
            className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Choose…
          </button>
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-slate-700">
          AssemblyAI API key <span className="font-normal text-slate-400">(transcription)</span>
        </label>
        <input
          type="password"
          value={assemblyAiKey}
          onChange={(e) => setAssemblyAiKey(e.target.value)}
          placeholder={settings?.hasAssemblyAiKey ? '••••••••  (saved — enter to replace)' : 'Paste key from assemblyai.com'}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-slate-700">
          Anthropic API key <span className="font-normal text-slate-400">(summaries)</span>
        </label>
        <input
          type="password"
          value={anthropicKey}
          onChange={(e) => setAnthropicKey(e.target.value)}
          placeholder={settings?.hasAnthropicKey ? '••••••••  (saved — enter to replace)' : 'Paste key from console.anthropic.com'}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
        <p className="mt-1.5 text-xs text-slate-400">
          Keys are stored encrypted on this Mac (Keychain) — never inside the meetings folder.
        </p>
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? 'Saving…' : submitLabel}
      </button>
    </div>
  );
}
