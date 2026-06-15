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

/** Map a completed AssemblyAI transcript payload into our schema. */
function mapResult(result: {
  text?: string;
  confidence?: number;
  utterances?: Array<{ speaker: string; text: string; start: number; end: number; confidence: number }>;
}): TranscriptionResult {
  const utterances: Utterance[] | null = result.utterances
    ? result.utterances.map((u) => ({
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
 * Submit a transcription job and return immediately with its id (no polling).
 * AssemblyAI fetches the audio from `audioUrl` itself, so this returns in
 * seconds even for multi-hour recordings — the caller polls for completion.
 */
export async function submitTranscription(audioUrl: string): Promise<string> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    throw new Error('ASSEMBLYAI_API_KEY is not set');
  }

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

  const { id } = await submitResponse.json();
  return id;
}

export interface TranscriptionStatus {
  status: 'queued' | 'processing' | 'completed' | 'error';
  result?: TranscriptionResult;
  error?: string;
}

/** Check the status of a previously-submitted transcription job. */
export async function getTranscriptionStatus(transcriptId: string): Promise<TranscriptionStatus> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    throw new Error('ASSEMBLYAI_API_KEY is not set');
  }

  const pollResponse = await fetch(`${ASSEMBLYAI_BASE_URL}/transcript/${transcriptId}`, {
    headers: { 'Authorization': apiKey },
  });

  if (!pollResponse.ok) {
    throw new Error('AssemblyAI poll failed');
  }

  const result = await pollResponse.json();

  if (result.status === 'completed') {
    return { status: 'completed', result: mapResult(result) };
  }
  if (result.status === 'error') {
    return { status: 'error', error: result.error || 'Transcription error' };
  }
  return { status: result.status === 'queued' ? 'queued' : 'processing' };
}

export async function transcribeAudio(audioUrl: string): Promise<TranscriptionResult> {
  const transcriptId = await submitTranscription(audioUrl);

  // Poll for completion (used by the synchronous segmented path)
  const maxAttempts = 120; // 10 minutes max (5s intervals)

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const status = await getTranscriptionStatus(transcriptId);
    if (status.status === 'completed' && status.result) {
      return status.result;
    }
    if (status.status === 'error') {
      throw new Error(`AssemblyAI error: ${status.error}`);
    }
  }

  throw new Error('Transcription timed out');
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
