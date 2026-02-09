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
