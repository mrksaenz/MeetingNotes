import type { AppSettings } from '@shared/types';
import SettingsForm from './SettingsForm';

export default function SettingsScreen({
  settings,
  onBack,
  onSaved,
}: {
  settings: AppSettings;
  onBack: () => void;
  onSaved: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="titlebar-drag flex h-12 shrink-0 items-center justify-center border-b border-slate-200 bg-white px-6">
        <button
          onClick={onBack}
          className="absolute left-20 text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          ← Back
        </button>
        <h1 className="text-sm font-semibold text-slate-900">Settings</h1>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <SettingsForm
            settings={settings}
            onSaved={() => {
              onSaved();
              onBack();
            }}
            submitLabel="Save settings"
          />
        </div>
      </div>
    </div>
  );
}
