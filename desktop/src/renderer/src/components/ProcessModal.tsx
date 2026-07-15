import { useState } from 'react';
import type { ProcessingLevel } from '@shared/types';

const TIERS: Array<{ level: ProcessingLevel; name: string; description: string }> = [
  {
    level: 'transcription_only',
    name: 'Transcription only',
    description: 'Speaker-separated transcript of the audio. Cheapest option.',
  },
  {
    level: 'summary',
    name: 'Transcription + Summary',
    description: 'Transcript plus an executive summary and key points.',
  },
  {
    level: 'full_analysis',
    name: 'Full analysis',
    description: 'Everything above, plus decisions and action items with owners.',
  },
];

export default function ProcessModal({
  hasUntranscribedAudio,
  onClose,
  onStart,
}: {
  hasUntranscribedAudio: boolean;
  onClose: () => void;
  onStart: (level: ProcessingLevel) => void;
}) {
  const [level, setLevel] = useState<ProcessingLevel>('full_analysis');

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Process meeting</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        <div className="space-y-2">
          {TIERS.map((tier) => (
            <label
              key={tier.level}
              className={`block cursor-pointer rounded-xl border p-3.5 transition ${
                level === tier.level
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <input
                type="radio"
                name="tier"
                className="sr-only"
                checked={level === tier.level}
                onChange={() => setLevel(tier.level)}
              />
              <p className="text-sm font-semibold text-slate-900">{tier.name}</p>
              <p className="mt-0.5 text-xs text-slate-500">{tier.description}</p>
            </label>
          ))}
        </div>

        {!hasUntranscribedAudio && (
          <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            All parts already have transcripts — only the summary step will run, no
            transcription credits used.
          </p>
        )}

        <button
          onClick={() => onStart(level)}
          className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Start processing
        </button>
        <p className="mt-2 text-center text-xs text-slate-400">
          Long recordings can take several minutes — keep the app open.
        </p>
      </div>
    </div>
  );
}
