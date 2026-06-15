import type { SupabaseClient } from '@supabase/supabase-js';
import { summarizeTranscription } from '@/lib/anthropic';
import type { ProcessingLevel } from '@/types/database';

interface TranscriptionRow {
  id: string;
  full_text: string;
}

interface PartRow {
  id: string;
  duration_seconds: number | null;
}

/**
 * Summarize a transcription with Claude and store the result, replacing any
 * prior summary so re-runs don't stack duplicates. No-op for transcription_only.
 */
export async function saveSummary(
  service: SupabaseClient,
  transcription: TranscriptionRow,
  processingLevel: ProcessingLevel,
  agendaText: string | null
): Promise<void> {
  if (processingLevel === 'transcription_only') return;

  const summary = await summarizeTranscription(
    transcription.full_text,
    processingLevel,
    agendaText
  );

  await service.from('summaries').delete().eq('transcription_id', transcription.id);
  await service.from('summaries').insert({
    transcription_id: transcription.id,
    executive_summary: summary.executiveSummary,
    key_points: summary.keyPoints,
    decisions: processingLevel === 'full_analysis' ? summary.decisions : null,
    action_items: processingLevel === 'full_analysis' ? summary.actionItems : null,
  });
}

/** Log usage cost and mark the recording part completed, clearing job state. */
export async function logUsageAndComplete(
  service: SupabaseClient,
  part: PartRow,
  userId: string,
  processingLevel: ProcessingLevel
): Promise<void> {
  const durationMinutes = (part.duration_seconds || 0) / 60;
  const transcriptionCost = durationMinutes * (0.15 / 60); // $0.15/hour
  const summaryCost = processingLevel !== 'transcription_only' ? 0.02 : 0;

  await service.from('usage_logs').insert({
    user_id: userId,
    recording_part_id: part.id,
    action_type: processingLevel,
    duration_minutes: durationMinutes,
    cost_usd: transcriptionCost + summaryCost,
  });

  await service
    .from('recording_parts')
    .update({ processing_status: 'completed', transcript_job_id: null, finalizing_at: null })
    .eq('id', part.id);
}
