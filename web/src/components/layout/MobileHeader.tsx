'use client';

import { useState } from 'react';
import type { Workspace } from '@/types/database';

interface MobileHeaderProps {
  workspaces: Workspace[];
  selectedWorkspace: Workspace | null;
  onSelectWorkspace: (workspace: Workspace) => void;
  onCreateWorkspace: () => void;
}

export default function MobileHeader({
  workspaces,
  selectedWorkspace,
  onSelectWorkspace,
  onCreateWorkspace,
}: MobileHeaderProps) {
  const [showDropdown, setShowDropdown] = useState(false);

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background px-4 md:hidden">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-600">
          <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
          </svg>
        </div>
        <span className="text-sm font-semibold">Meeting Notes</span>
      </div>

      {/* Workspace selector */}
      <div className="relative">
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface"
        >
          {selectedWorkspace && (
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: selectedWorkspace.color || '#3b82f6' }}
            />
          )}
          <span className="max-w-[120px] truncate">
            {selectedWorkspace?.name || 'Select workspace'}
          </span>
          <svg className="h-4 w-4 text-muted" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        {showDropdown && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
            <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-background shadow-lg">
              <div className="p-1">
                {workspaces.map((ws) => (
                  <button
                    key={ws.id}
                    onClick={() => {
                      onSelectWorkspace(ws);
                      setShowDropdown(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                      selectedWorkspace?.id === ws.id
                        ? 'bg-primary-50 text-primary-700'
                        : 'text-foreground hover:bg-surface'
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: ws.color || '#3b82f6' }}
                    />
                    {ws.name}
                  </button>
                ))}
                <div className="my-1 border-t border-border" />
                <button
                  onClick={() => {
                    onCreateWorkspace();
                    setShowDropdown(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted hover:bg-surface hover:text-foreground"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  New workspace
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
