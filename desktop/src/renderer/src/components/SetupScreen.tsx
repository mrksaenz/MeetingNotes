import type { AppSettings } from '@shared/types';
import SettingsForm from './SettingsForm';

export default function SetupScreen({
  settings,
  onDone,
}: {
  settings: AppSettings | null;
  onDone: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="titlebar-drag h-10 shrink-0" />
      <div className="flex flex-1 items-start justify-center overflow-y-auto px-6 pb-10">
        <div className="w-full max-w-lg">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-2xl font-bold text-white">
              M
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Welcome to MeetingNotes</h1>
            <p className="mt-2 text-sm text-slate-500">
              Record or upload meetings, get AI transcription and summaries, and save clean
              PDF notes — all stored as files in a folder you choose. No accounts, no database.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <SettingsForm settings={settings} onSaved={onDone} submitLabel="Get started" />
          </div>
        </div>
      </div>
    </div>
  );
}
