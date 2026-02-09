import Anthropic from '@anthropic-ai/sdk';
import type { ProcessingLevel } from '@/types/database';

interface SummaryResult {
  executiveSummary: string;
  keyPoints: string[];
  decisions: string[] | null;
  actionItems: ActionItem[] | null;
}

interface ActionItem {
  action: string;
  owner: string | null;
  deadline: string | null;
}

export async function summarizeTranscription(
  transcriptionText: string,
  processingLevel: ProcessingLevel
): Promise<SummaryResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }

  const client = new Anthropic({ apiKey });

  const isFullAnalysis = processingLevel === 'full_analysis';

  const prompt = isFullAnalysis
    ? `Analyze this meeting transcription and provide a structured summary in JSON format.

Return ONLY valid JSON with this exact structure:
{
  "executiveSummary": "2-3 sentence overview of the meeting",
  "keyPoints": ["point 1", "point 2", ...],
  "decisions": ["decision 1", "decision 2", ...],
  "actionItems": [
    {"action": "description", "owner": "person name or null", "deadline": "deadline or null"},
    ...
  ]
}

If there are no decisions, use an empty array. Same for action items.

Transcription:
${transcriptionText}`
    : `Analyze this meeting transcription and provide a brief summary in JSON format.

Return ONLY valid JSON with this exact structure:
{
  "executiveSummary": "2-3 sentence overview of the meeting",
  "keyPoints": ["point 1", "point 2", ...]
}

Transcription:
${transcriptionText}`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  // Extract the text response
  const textBlock = message.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  // Parse JSON from response (handle potential markdown code blocks)
  let jsonStr = textBlock.text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = JSON.parse(jsonStr);

  return {
    executiveSummary: parsed.executiveSummary || '',
    keyPoints: parsed.keyPoints || [],
    decisions: isFullAnalysis ? (parsed.decisions || []) : null,
    actionItems: isFullAnalysis ? (parsed.actionItems || []) : null,
  };
}
