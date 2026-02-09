'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Workspace } from '@/types/database';

export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const fetchWorkspaces = useCallback(async () => {
    const { data, error } = await supabase
      .from('workspaces')
      .select('*')
      .order('created_at', { ascending: true });

    if (!error && data) {
      setWorkspaces(data);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  async function createWorkspace(name: string, color?: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('workspaces')
      .insert({ name, color, user_id: user.id })
      .select()
      .single();

    if (!error && data) {
      setWorkspaces((prev) => [...prev, data]);
      return data;
    }
    return null;
  }

  return { workspaces, loading, createWorkspace, refetch: fetchWorkspaces };
}
