import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/service';
import { transcribeSegments, submitTranscription } from '@/lib/assemblyai';
import { saveSummary, logUsageAndComplete } from '@/lib/processingShared';
import type { ProcessingLevel } from '@/types/database';
import { cookies } from 'next/headers';

// Submitting a job returns quickly; long transcriptions complete via
// /api/process/status polling, so this route no longer needs a long timeout.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    // Authenticate the user via cookies
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
    const processingLevel = body.processingLevel as ProcessingLevel;

    if (!recordingPartId || !processingLevel) {
      return NextResponse.json(
        { error: 'Missing recordingPartId or processingLevel' },
        { status: 400 }
      );
    }

    const service = createServiceClient();

    // Fetch recording part
    const { data: part, error: partError } = await service
      .from('recording_parts')
      .select('*')
      .eq('id', recordingPartId)
      .single();

    if (partError || !part) {
      console.error('Part lookup error:', partError);
      return NextResponse.json({ error: 'Recording part not found' }, { status: 404 });
    }

    // Verify ownership via meeting (and load the agenda for AI context)
    const { data: meetingData, error: meetingError } = await service
      .from('meetings')
      .select('user_id, agenda_text')
      .eq('id', part.meeting_id)
      .single();

    if (meetingError || !meetingData) {
      console.error('Meeting lookup error:', meetingError);
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    if (meetingData.user_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    await service
      .from('recording_parts')
      .update({ processing_status: 'processing' })
      .eq('id', recordingPartId);

    // ── Case 1: a transcript already exists (manual upload, or re-summarize) ──
    const { data: existing } = await service
      .from('transcriptions')
      .select('*')
      .eq('recording_part_id', recordingPartId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      await service
        .from('transcriptions')
        .update({ processing_level: processingLevel })
        .eq('id', existing.id);
      try {
        await saveSummary(service, existing, processingLevel, meetingData.agenda_text);
      } catch (err) {
        console.error('Summarization failed:', err);
      }
      await logUsageAndComplete(service, part, user.id, processingLevel);
      return NextResponse.json({ status: 'completed' });
    }

    // ── Case 2: segmented recording (in-app recorder) — kept synchronous ──
    const { data: segments } = await service
      .from('recording_segments')
      .select('*')
      .eq('recording_part_id', recordingPartId)
      .eq('upload_status', 'uploaded')
      .order('segment_number', { ascending: true });

    if (segments && segments.length > 0) {
      try {
        const segmentData: Array<{ audioData: Blob; durationSeconds: number }> = [];
        for (const seg of segments) {
          const { data: fileData, error: downloadError } = await service.storage
            .from('recordings')
            .download(seg.audio_file_path);
          if (downloadError || !fileData) {
            throw new Error(`Failed to download segment ${seg.segment_number}: ${downloadError?.message}`);
          }
          segmentData.push({ audioData: fileData, durationSeconds: seg.duration_seconds });
        }

        const result = await transcribeSegments(segmentData);
        const { data: inserted, error: insertErr } = await service
          .from('transcriptions')
          .insert({
            recording_part_id: recordingPartId,
            full_text: result.text,
            speakers: result.utterances,
            confidence_score: result.confidence,
            provider: 'assemblyai',
            processing_level: processingLevel,
          })
          .select()
          .single();
        if (insertErr || !inserted) {
          throw new Error(insertErr?.message || 'Failed to save transcription');
        }

        try {
          await saveSummary(service, inserted, processingLevel, meetingData.agenda_text);
        } catch (err) {
          console.error('Summarization failed:', err);
        }
        await logUsageAndComplete(service, part, user.id, processingLevel);
        return NextResponse.json({ status: 'completed' });
      } catch (err) {
        console.error('Segmented transcription failed:', err);
        await service
          .from('recording_parts')
          .update({ processing_status: 'failed' })
          .eq('id', recordingPartId);
        const message = err instanceof Error ? err.message : 'Segmented transcription failed';
        return NextResponse.json({ error: message }, { status: 500 });
      }
    }

    // ── Case 3: single uploaded file — submit ASYNC and poll via /status ──
    if (!part.audio_file_path) {
      await service
        .from('recording_parts')
        .update({ processing_status: 'failed' })
        .eq('id', recordingPartId);
      return NextResponse.json({ error: 'No audio to transcribe' }, { status: 400 });
    }

    const { data: signedUrl, error: signedUrlError } = await service.storage
      .from('recordings')
      .createSignedUrl(part.audio_file_path, 86400); // 24h — plenty for AssemblyAI to fetch

    if (!signedUrl?.signedUrl) {
      console.error('Signed URL error:', signedUrlError);
      await service
        .from('recording_parts')
        .update({ processing_status: 'failed' })
        .eq('id', recordingPartId);
      return NextResponse.json({ error: 'Failed to get audio URL' }, { status: 500 });
    }

    let jobId: string;
    try {
      jobId = await submitTranscription(signedUrl.signedUrl);
    } catch (err) {
      console.error('Transcription submit failed:', err);
      await service
        .from('recording_parts')
        .update({ processing_status: 'failed' })
        .eq('id', recordingPartId);
      const message = err instanceof Error ? err.message : 'Failed to submit transcription';
      return NextResponse.json({ error: message }, { status: 500 });
    }

    await service
      .from('recording_parts')
      .update({ transcript_job_id: jobId, requested_level: processingLevel, finalizing_at: null })
      .eq('id', recordingPartId);

    return NextResponse.json({ status: 'submitted', jobId });
  } catch (err) {
    console.error('Processing error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
