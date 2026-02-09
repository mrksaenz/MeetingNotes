import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { transcribeAudio } from '@/lib/assemblyai';
import { summarizeTranscription } from '@/lib/anthropic';
import type { ProcessingLevel } from '@/types/database';

export async function POST(request: NextRequest) {
  try {
    // Authenticate the user
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { recordingPartId, processingLevel } = await request.json() as {
      recordingPartId: string;
      processingLevel: ProcessingLevel;
    };

    if (!recordingPartId || !processingLevel) {
      return NextResponse.json(
        { error: 'Missing recordingPartId or processingLevel' },
        { status: 400 }
      );
    }

    // Use service client for server-side operations (bypasses RLS)
    const serviceClient = createServiceClient();

    // Fetch recording part and verify ownership
    const { data: part, error: partError } = await serviceClient
      .from('recording_parts')
      .select('*, meetings!inner(user_id)')
      .eq('id', recordingPartId)
      .single();

    if (partError || !part) {
      return NextResponse.json({ error: 'Recording part not found' }, { status: 404 });
    }

    // Verify the user owns this recording
    const meeting = part.meetings as { user_id: string };
    if (meeting.user_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Mark as processing
    await serviceClient
      .from('recording_parts')
      .update({ processing_status: 'processing' })
      .eq('id', recordingPartId);

    // Get a signed URL for the audio file
    const { data: signedUrl } = await serviceClient.storage
      .from('recordings')
      .createSignedUrl(part.audio_file_path, 3600); // 1 hour expiry

    if (!signedUrl?.signedUrl) {
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
      return NextResponse.json({ error: 'Transcription failed' }, { status: 500 });
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
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
