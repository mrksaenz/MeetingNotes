'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import type { Workspace } from '@/types/database';

const WORKSPACE_COLORS = [
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Rose', value: '#f43f5e' },
  { name: 'Emerald', value: '#10b981' },
  { name: 'Sky', value: '#0ea5e9' },
];

interface SidebarProps {
  workspaces: Workspace[];
  selectedWorkspace: Workspace | null;
  onSelectWorkspace: (workspace: Workspace) => void;
  onCreateWorkspace: (name: string, color: string) => void;
}

export default function Sidebar({
  workspaces,
  selectedWorkspace,
  onSelectWorkspace,
  onCreateWorkspace,
}: SidebarProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(WORKSPACE_COLORS[0].value);
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/auth/login');
    router.refresh();
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (newName.trim()) {
      onCreateWorkspace(newName.trim(), newColor);
      setNewName('');
      setNewColor(WORKSPACE_COLORS[0].value);
      setShowCreate(false);
    }
  }

  return (
    <aside className="hidden md:flex md:w-64 md:flex-col md:border-r md:border-border bg-surface h-screen sticky top-0">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 px-4 border-b border-border">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600">
          <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
          </svg>
        </div>
        <span className="text-lg font-semibold text-foreground">Meeting Notes</span>
      </div>

      {/* Workspaces */}
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted">Workspaces</span>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="rounded-md p-1 text-muted hover:bg-border hover:text-foreground transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
        </div>

        {showCreate && (
          <form onSubmit={handleCreate} className="mb-3 rounded-lg border border-border bg-background p-3 space-y-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Workspace name"
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder-muted focus:border-primary-500 focus:ring-1 focus:ring-primary-500/20 focus:outline-none"
              autoFocus
            />
            <div className="flex gap-1.5">
              {WORKSPACE_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setNewColor(c.value)}
                  className={`h-6 w-6 rounded-full transition-all ${newColor === c.value ? 'ring-2 ring-offset-2 ring-primary-500' : ''}`}
                  style={{ backgroundColor: c.value }}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="flex-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        <nav className="space-y-1">
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              onClick={() => onSelectWorkspace(ws)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                selectedWorkspace?.id === ws.id
                  ? 'bg-primary-50 text-primary-700 font-medium'
                  : 'text-foreground hover:bg-surface'
              }`}
            >
              <span
                className="h-3 w-3 rounded-full shrink-0"
                style={{ backgroundColor: ws.color || '#3b82f6' }}
              />
              <span className="truncate">{ws.name}</span>
            </button>
          ))}

          {workspaces.length === 0 && !showCreate && (
            <p className="px-3 py-4 text-sm text-muted text-center">
              No workspaces yet. Create one to get started.
            </p>
          )}
        </nav>
      </div>

      {/* Sign out */}
      <div className="border-t border-border p-3">
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface hover:text-foreground transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
          </svg>
          Sign out
        </button>
      </div>
    </aside>
  );
}
