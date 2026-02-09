import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/service';
import { transcribeAudio } from '@/lib/assemblyai';
import { summarizeTranscription } from '@/lib/anthropic';
import type { ProcessingLevel } from '@/types/database';
import { cookies } from 'next/headers';

// Allow up to 5 minutes for long transcriptions
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

    // Use service client for server-side operations (bypasses RLS)
    const serviceClient = createServiceClient();

    // Fetch recording part
    const { data: part, error: partError } = await serviceClient
      .from('recording_parts')
      .select('*')
      .eq('id', recordingPartId)
      .single();

    if (partError || !part) {
      console.error('Part lookup error:', partError);
      return NextResponse.json({ error: 'Recording part not found' }, { status: 404 });
    }

    // Verify ownership via meeting
    const { data: meetingData, error: meetingError } = await serviceClient
      .from('meetings')
      .select('user_id')
      .eq('id', part.meeting_id)
      .single();

    if (meetingError || !meetingData) {
      console.error('Meeting lookup error:', meetingError);
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    if (meetingData.user_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Mark as processing
    await serviceClient
      .from('recording_parts')
      .update({ processing_status: 'processing' })
      .eq('id', recordingPartId);

    // Get a signed URL for the audio file
    const { data: signedUrl, error: signedUrlError } = await serviceClient.storage
      .from('recordings')
      .createSignedUrl(part.audio_file_path, 3600); // 1 hour expiry

    if (!signedUrl?.signedUrl) {
      console.error('Signed URL error:', signedUrlError);
      await serviceClient
        .from('recording_parts')
        .update({ processing_status: 'failed' })
        .eq('id', recordingPartId);
      return NextResponse.json({ error: 'Failed to get audio URL' }, { status: 500 });
    }

    // Step 1: Transcribe with AssemblyAI
    let transcriptionResult;
    try {
      transcriptionResult = await transcribeAudio(signedUrl.signedUrl);
    } catch (err) {
      console.error('Transcription failed:', err);
      await serviceClient
        .from('recording_parts')
        .update({ processing_status: 'failed' })
        .eq('id', recordingPartId);
      const message = err instanceof Error ? err.message : 'Transcription failed';
      return NextResponse.json({ error: message }, { status: 500 });
    }

    // Save transcription
    const { data: transcription, error: transcriptionError } = await serviceClient
      .from('transcriptions')
      .insert({
        recording_part_id: recordingPartId,
        full_text: transcriptionResult.text,
        speakers: transcriptionResult.utterances,
        confidence_score: transcriptionResult.confidence,
        provider: 'assemblyai',
        processing_level: processingLevel,
      })
      .select()
      .single();

    if (transcriptionError || !transcription) {
      console.error('Failed to save transcription:', transcriptionError);
      await serviceClient
        .from('recording_parts')
        .update({ processing_status: 'failed' })
        .eq('id', recordingPartId);
      return NextResponse.json({ error: 'Failed to save transcription' }, { status: 500 });
    }

    // Step 2: Summarize with Claude (if requested)
    if (processingLevel === 'summary' || processingLevel === 'full_analysis') {
      try {
        const summaryResult = await summarizeTranscription(
          transcriptionResult.text,
          processingLevel
        );

        await serviceClient
          .from('summaries')
          .insert({
            transcription_id: transcription.id,
            executive_summary: summaryResult.executiveSummary,
            key_points: summaryResult.keyPoints,
            decisions: processingLevel === 'full_analysis' ? summaryResult.decisions : null,
            action_items: processingLevel === 'full_analysis' ? summaryResult.actionItems : null,
          });
      } catch (err) {
        console.error('Summarization failed:', err);
        // Don't fail the whole process — transcription is still saved
      }
    }

    // Log usage
    const durationMinutes = part.duration_seconds / 60;
    const transcriptionCost = durationMinutes * (0.15 / 60); // $0.15/hour
    const summaryCost = processingLevel !== 'transcription_only' ? 0.02 : 0;

    await serviceClient
      .from('usage_logs')
      .insert({
        user_id: user.id,
        recording_part_id: recordingPartId,
        action_type: processingLevel,
        duration_minutes: durationMinutes,
        cost_usd: transcriptionCost + summaryCost,
      });

    // Mark as completed
    await serviceClient
      .from('recording_parts')
      .update({ processing_status: 'completed' })
      .eq('id', recordingPartId);

    return NextResponse.json({ success: true, transcriptionId: transcription.id });
  } catch (err) {
    console.error('Processing error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
