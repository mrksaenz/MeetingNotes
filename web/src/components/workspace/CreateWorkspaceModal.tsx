'use client';

import { useState } from 'react';

const WORKSPACE_COLORS = [
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Rose', value: '#f43f5e' },
  { name: 'Emerald', value: '#10b981' },
  { name: 'Sky', value: '#0ea5e9' },
];

interface CreateWorkspaceModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, color: string) => void;
}

export default function CreateWorkspaceModal({ open, onClose, onCreate }: CreateWorkspaceModalProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(WORKSPACE_COLORS[0].value);

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim()) {
      onCreate(name.trim(), color);
      setName('');
      setColor(WORKSPACE_COLORS[0].value);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-xl border border-border bg-background p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-foreground">Create workspace</h2>
        <p className="mt-1 text-sm text-muted">Organize your meetings by context</p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="ws-name" className="block text-sm font-medium text-foreground">
              Name
            </label>
            <input
              id="ws-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., EPISD, TBA Board"
              className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder-muted focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Color</label>
            <div className="flex gap-2">
              {WORKSPACE_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(c.value)}
                  className={`h-8 w-8 rounded-full transition-all ${
                    color === c.value ? 'ring-2 ring-offset-2 ring-primary-500' : ''
                  }`}
                  style={{ backgroundColor: c.value }}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-surface transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
