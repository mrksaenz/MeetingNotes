'use client';

import { useState } from 'react';
import type { ProcessingLevel, RecordingPart } from '@/types/database';

interface ProcessModalProps {
  open: boolean;
  parts: RecordingPart[];
  onClose: () => void;
  onProcess: (partIds: string[], level: ProcessingLevel) => void;
  processing: boolean;
}

const TIERS: { level: ProcessingLevel; label: string; description: string }[] = [
  {
    level: 'transcription_only',
    label: 'Transcription Only',
    description: 'Convert audio to text with speaker identification',
  },
  {
    level: 'summary',
    label: 'Transcription + Summary',
    description: 'Transcription plus a brief summary with key points',
  },
  {
    level: 'full_analysis',
    label: 'Full Analysis',
    description: 'Transcription, executive summary, decisions, and action items',
  },
];

export default function ProcessModal({ open, parts, onClose, onProcess, processing }: ProcessModalProps) {
  const [selectedLevel, setSelectedLevel] = useState<ProcessingLevel>('full_analysis');

  if (!open) return null;

  const unprocessedParts = parts.filter((p) => p.processing_status === 'unprocessed' || p.processing_status === 'failed');

  function handleProcess() {
    const partIds = unprocessedParts.map((p) => p.id);
    onProcess(partIds, selectedLevel);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-foreground">Process recordings</h2>
        <p className="mt-1 text-sm text-muted">
          {unprocessedParts.length} part{unprocessedParts.length !== 1 ? 's' : ''} ready to process
        </p>

        {/* Tier selection */}
        <div className="mt-4 space-y-2">
          {TIERS.map((tier) => (
            <label
              key={tier.level}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                selectedLevel === tier.level
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-border hover:bg-surface'
              }`}
            >
              <input
                type="radio"
                name="processing-level"
                value={tier.level}
                checked={selectedLevel === tier.level}
                onChange={() => setSelectedLevel(tier.level)}
                className="mt-0.5 h-4 w-4 text-primary-600 focus:ring-primary-500"
              />
              <div>
                <span className="text-sm font-medium text-foreground">{tier.label}</span>
                <p className="text-xs text-muted">{tier.description}</p>
              </div>
            </label>
          ))}
        </div>

        {/* Actions */}
        <div className="mt-6 flex gap-3">
          <button
            onClick={onClose}
            disabled={processing}
            className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-surface transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleProcess}
            disabled={processing || unprocessedParts.length === 0}
            className="flex-1 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-700 transition-colors disabled:opacity-50"
          >
            {processing ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Processing...
              </span>
            ) : (
              `Process ${unprocessedParts.length} part${unprocessedParts.length !== 1 ? 's' : ''}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
