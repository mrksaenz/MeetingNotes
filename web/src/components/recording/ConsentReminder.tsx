'use client';

interface ConsentReminderProps {
  onAccept: () => void;
  onCancel: () => void;
}

export default function ConsentReminder({ onAccept, onCancel }: ConsentReminderProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative w-full max-w-sm rounded-xl border border-border bg-background p-6 shadow-xl">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent-amber/10">
          <svg className="h-6 w-6 text-accent-amber" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>

        <h2 className="text-center text-lg font-semibold text-foreground">Recording consent</h2>
        <p className="mt-2 text-center text-sm text-muted">
          Please ensure all participants have given their consent to be recorded. You are responsible for complying with local recording laws.
        </p>

        <div className="mt-6 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-surface transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onAccept}
            className="flex-1 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
          >
            I have consent
          </button>
        </div>
      </div>
    </div>
  );
}
