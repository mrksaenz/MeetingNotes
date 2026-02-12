interface TranscriptionResult {
  text: string;
  utterances: Utterance[] | null;
  confidence: number;
}

interface Utterance {
  speaker: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
}

const ASSEMBLYAI_BASE_URL = 'https://api.assemblyai.com/v2';

export async function transcribeAudio(audioUrl: string): Promise<TranscriptionResult> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    throw new Error('ASSEMBLYAI_API_KEY is not set');
  }

  // Submit transcription job
  const submitResponse = await fetch(`${ASSEMBLYAI_BASE_URL}/transcript`, {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      speech_models: ['universal-2'],
      speaker_labels: true,
      language_code: 'en',
    }),
  });

  if (!submitResponse.ok) {
    const error = await submitResponse.text();
    throw new Error(`AssemblyAI submit failed: ${error}`);
  }

  const { id: transcriptId } = await submitResponse.json();

  // Poll for completion
  let result;
  const maxAttempts = 120; // 10 minutes max (5s intervals)

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const pollResponse = await fetch(`${ASSEMBLYAI_BASE_URL}/transcript/${transcriptId}`, {
      headers: { 'Authorization': apiKey },
    });

    if (!pollResponse.ok) {
      throw new Error('AssemblyAI poll failed');
    }

    result = await pollResponse.json();

    if (result.status === 'completed') {
      break;
    }
    if (result.status === 'error') {
      throw new Error(`AssemblyAI error: ${result.error}`);
    }
  }

  if (!result || result.status !== 'completed') {
    throw new Error('Transcription timed out');
  }

  // Format utterances for our schema
  const utterances: Utterance[] | null = result.utterances
    ? result.utterances.map((u: { speaker: string; text: string; start: number; end: number; confidence: number }) => ({
        speaker: u.speaker,
        text: u.text,
        start: u.start,
        end: u.end,
        confidence: u.confidence,
      }))
    : null;

  return {
    text: result.text || '',
    utterances,
    confidence: result.confidence || 0,
  };
}

/**
 * Upload raw audio binary to AssemblyAI's upload endpoint.
 * Returns an upload_url that can be used for transcription.
 */
export async function uploadToAssemblyAI(audioData: Blob | Uint8Array): Promise<string> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    throw new Error('ASSEMBLYAI_API_KEY is not set');
  }

  const buffer = audioData instanceof Blob
    ? Buffer.from(await audioData.arrayBuffer())
    : Buffer.from(audioData);

  const response = await fetch(`${ASSEMBLYAI_BASE_URL}/upload`, {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/octet-stream',
    },
    body: buffer,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AssemblyAI upload failed: ${errorText}`);
  }

  const { upload_url } = await response.json();
  return upload_url;
}

/**
 * Transcribe multiple segments individually, then merge results with time offsets.
 * Each segment is uploaded to AssemblyAI and transcribed separately.
 * Timestamps in utterances are adjusted with cumulative offsets.
 */
export async function transcribeSegments(
  segments: Array<{ audioData: Blob; durationSeconds: number }>
): Promise<TranscriptionResult> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    throw new Error('ASSEMBLYAI_API_KEY is not set');
  }

  const results: Array<{ result: TranscriptionResult; offsetMs: number }> = [];
  let cumulativeOffsetMs = 0;

  for (const segment of segments) {
    // Upload segment to AssemblyAI
    const uploadUrl = await uploadToAssemblyAI(segment.audioData);

    // Transcribe
    const result = await transcribeAudio(uploadUrl);

    results.push({ result, offsetMs: cumulativeOffsetMs });
    cumulativeOffsetMs += segment.durationSeconds * 1000;
  }

  // Merge all results
  const mergedText = results.map(r => r.result.text).join(' ');

  const mergedUtterances: Utterance[] = [];
  for (const { result, offsetMs } of results) {
    if (result.utterances) {
      for (const utt of result.utterances) {
        mergedUtterances.push({
          ...utt,
          start: utt.start + offsetMs,
          end: utt.end + offsetMs,
        });
      }
    }
  }

  // Average confidence across all segments
  const totalConfidence = results.reduce((sum, r) => sum + r.result.confidence, 0);
  const avgConfidence = results.length > 0 ? totalConfidence / results.length : 0;

  return {
    text: mergedText,
    utterances: mergedUtterances.length > 0 ? mergedUtterances : null,
    confidence: avgConfidence,
  };
}
