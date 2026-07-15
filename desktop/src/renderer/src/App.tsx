import { useCallback, useEffect, useState } from 'react';
import type { AppSettings } from '@shared/types';
import { ToastProvider } from './lib/toast';
import SetupScreen from './components/SetupScreen';
import SettingsScreen from './components/SettingsScreen';
import MeetingList from './components/MeetingList';
import MeetingDetail from './components/MeetingDetail';
import RecordScreen from './components/RecordScreen';

type View =
  | { name: 'library' }
  | { name: 'meeting'; id: string }
  | { name: 'settings' }
  | { name: 'record'; meetingId: string; meetingTitle: string };

export default function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<View>({ name: 'library' });

  const refreshSettings = useCallback(async () => {
    const s = await window.api.getSettings();
    setSettings(s);
    setLoaded(true);
    return s;
  }, []);

  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  if (!loaded) {
    return <div className="flex h-full items-center justify-center text-slate-400">Loading…</div>;
  }

  const needsSetup = !settings?.libraryPath || !settings?.hasAssemblyAiKey || !settings?.hasAnthropicKey;

  return (
    <ToastProvider>
      {needsSetup ? (
        <SetupScreen settings={settings} onDone={refreshSettings} />
      ) : view.name === 'settings' ? (
        <SettingsScreen
          settings={settings!}
          onBack={() => setView({ name: 'library' })}
          onSaved={refreshSettings}
        />
      ) : view.name === 'meeting' ? (
        <MeetingDetail
          meetingId={view.id}
          onBack={() => setView({ name: 'library' })}
          onRecordPart={(meetingId, meetingTitle) =>
            setView({ name: 'record', meetingId, meetingTitle })
          }
        />
      ) : view.name === 'record' ? (
        <RecordScreen
          meetingId={view.meetingId}
          meetingTitle={view.meetingTitle}
          onDone={() => setView({ name: 'meeting', id: view.meetingId })}
        />
      ) : (
        <MeetingList
          onOpenMeeting={(id) => setView({ name: 'meeting', id })}
          onOpenSettings={() => setView({ name: 'settings' })}
          onRecordMeeting={(meetingId, meetingTitle) =>
            setView({ name: 'record', meetingId, meetingTitle })
          }
        />
      )}
    </ToastProvider>
  );
}
