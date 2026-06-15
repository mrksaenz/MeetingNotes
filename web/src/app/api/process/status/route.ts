import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/service';
import { getTranscriptionStatus } from '@/lib/assemblyai';
import { saveSummary, logUsageAndComplete } from '@/lib/processingShared';
import type { ProcessingLevel } from '@/types/database';
import { cookies } from 'next/headers';

// The finalizing poll may run map-reduce summarization, so allow headroom.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Ignored in API routes
            }
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const recordingPartId = body.recordingPartId as string;
    if (!recordingPartId) {
      return NextResponse.json({ error: 'Missing recordingPartId' }, { status: 400 });
    }

    const service = createServiceClient();

    const { data: part, error: partError } = await service
      .from('recording_parts')
      .select('*')
      .eq('id', recordingPartId)
      .single();
    if (partError || !part) {
      return NextResponse.json({ error: 'Recording part not found' }, { status: 404 });
    }

    const { data: meetingData, error: meetingError } = await service
      .from('meetings')
      .select('user_id, agenda_text')
      .eq('id', part.meeting_id)
      .single();
    if (meetingError || !meetingData) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }
    if (meetingData.user_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // No async job tracked → nothing to advance; report current state.
    if (!part.transcript_job_id) {
      return NextResponse.json({ status: part.processing_status });
    }

    const job = await getTranscriptionStatus(part.transcript_job_id);

    if (job.status === 'queued' || job.status === 'processing') {
      return NextResponse.json({ status: 'processing' });
    }

    if (job.status === 'error') {
      await service
        .from('recording_parts')
        .update({ processing_status: 'failed', transcript_job_id: null, finalizing_at: null })
        .eq('id', recordingPartId);
      return NextResponse.json({ status: 'failed', error: job.error });
    }

    // job.status === 'completed' → finalize once, guarded by a claim lock so
    // overlapping polls don't double-insert transcripts or re-summarize.
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: claimed } = await service
      .from('recording_parts')
      .update({ finalizing_at: new Date().toISOString() })
      .eq('id', recordingPartId)
      .or(`finalizing_at.is.null,finalizing_at.lt.${tenMinutesAgo}`)
      .select();

    if (!claimed || claimed.length === 0) {
      // Another request is already finalizing this part.
      return NextResponse.json({ status: 'processing' });
    }

    const level = (part.requested_level as ProcessingLevel) || 'full_analysis';

    // Insert the transcription if it isn't already saved (idempotent on retry).
    const { data: existing } = await service
      .from('transcriptions')
      .select('*')
      .eq('recording_part_id', recordingPartId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let transcription = existing;
    if (!transcription) {
      const result = job.result!;
      const { data: inserted, error: insertErr } = await service
        .from('transcriptions')
        .insert({
          recording_part_id: recordingPartId,
          full_text: result.text,
          speakers: result.utterances,
          confidence_score: result.confidence,
          provider: 'assemblyai',
          processing_level: level,
        })
        .select()
        .single();
      if (insertErr || !inserted) {
        await service
          .from('recording_parts')
          .update({ processing_status: 'failed', finalizing_at: null })
          .eq('id', recordingPartId);
        return NextResponse.json({ error: 'Failed to save transcription' }, { status: 500 });
      }
      transcription = inserted;
    }

    try {
      await saveSummary(service, transcription, level, meetingData.agenda_text);
    } catch (err) {
      console.error('Summarization failed:', err);
      // Transcription is saved; don't fail the whole finalize.
    }

    await logUsageAndComplete(service, part, user.id, level);

    return NextResponse.json({ status: 'completed' });
  } catch (err) {
    console.error('Status poll error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
