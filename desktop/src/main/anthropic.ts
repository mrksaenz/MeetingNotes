import Anthropic from '@anthropic-ai/sdk';
import type { ActionItem, ProcessingLevel } from '@shared/types';

/**
 * Claude summarization, ported from web/src/lib/anthropic.ts. Single pass for
 * short meetings; map-reduce above ~40k chars so 5-hour board meetings fit.
 * The agenda + instructions are sent as a prompt-cached system block so they
 * aren't re-billed across chunks.
 */

export interface SummaryResult {
  executiveSummary: string;
  keyPoints: string[];
  decisions: string[] | null;
  actionItems: ActionItem[] | null;
}

const MODEL = 'claude-haiku-4-5-20251001';

// Above this many characters we switch from a single pass to map-reduce.
const MAP_REDUCE_THRESHOLD = 40_000;
// Target size of each map chunk (~7-8k tokens of transcript).
const CHUNK_SIZE = 30_000;

/** Pull the first text block out of a Claude response and parse it as JSON. */
function parseJsonResponse(message: Anthropic.Message): Record<string, unknown> {
  const textBlock = message.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }
  let jsonStr = textBlock.text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  return JSON.parse(jsonStr);
}

function buildSystem(agenda?: string | null): Anthropic.MessageCreateParams['system'] {
  const base =
    'You are an expert meeting analyst. You produce accurate, concise notes for ' +
    'a board of directors. Only report what is supported by the transcript — never ' +
    'invent decisions or action items. Prefer the speaker names used in the transcript ' +
    'when attributing action items.';

  const text = agenda?.trim()
    ? `${base}\n\nThe meeting followed this agenda. Organize your analysis around these items and map decisions/action items to them where possible:\n\n${agenda.trim()}`
    : base;

  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
}

/** Split a long transcript into chunks on whitespace boundaries. */
function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + size, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf('\n', end);
      const space = text.lastIndexOf(' ', end);
      const cut = Math.max(boundary, space);
      if (cut > i) end = cut;
    }
    chunks.push(text.slice(i, end).trim());
    i = end;
  }
  return chunks.filter(Boolean);
}

// ─── Single-pass summarization (short meetings) ──────────────────────────────

async function summarizeSinglePass(
  client: Anthropic,
  transcriptionText: string,
  isFullAnalysis: boolean,
  agenda?: string | null
): Promise<SummaryResult> {
  const schema = isFullAnalysis
    ? `{
  "executiveSummary": "2-4 sentence overview of the meeting",
  "keyPoints": ["point 1", "point 2", ...],
  "decisions": ["decision 1", "decision 2", ...],
  "actionItems": [
    {"action": "description", "owner": "person name or null", "deadline": "deadline or null"}
  ]
}`
    : `{
  "executiveSummary": "2-4 sentence overview of the meeting",
  "keyPoints": ["point 1", "point 2", ...]
}`;

  const prompt = `Analyze this meeting transcription and return ONLY valid JSON with this exact structure:
${schema}

${isFullAnalysis ? 'Use empty arrays when there are no decisions or action items.\n' : ''}
Transcription:
${transcriptionText}`;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: buildSystem(agenda),
    messages: [{ role: 'user', content: prompt }],
  });

  const parsed = parseJsonResponse(message);
  return {
    executiveSummary: (parsed.executiveSummary as string) || '',
    keyPoints: (parsed.keyPoints as string[]) || [],
    decisions: isFullAnalysis ? ((parsed.decisions as string[]) || []) : null,
    actionItems: isFullAnalysis ? ((parsed.actionItems as ActionItem[]) || []) : null,
  };
}

// ─── Map-reduce summarization (long meetings) ────────────────────────────────

interface ChunkExtract {
  keyPoints: string[];
  decisions: string[];
  actionItems: ActionItem[];
}

async function extractFromChunk(
  client: Anthropic,
  chunk: string,
  index: number,
  total: number,
  isFullAnalysis: boolean,
  agenda?: string | null
): Promise<ChunkExtract> {
  const schema = isFullAnalysis
    ? `{ "keyPoints": [...], "decisions": [...], "actionItems": [{"action": "...", "owner": null, "deadline": null}] }`
    : `{ "keyPoints": [...] }`;

  const prompt = `This is part ${index + 1} of ${total} of a long meeting transcript. Extract ONLY the notable content from THIS part. Return ONLY valid JSON:
${schema}

Use empty arrays where nothing applies. Do not summarize the whole meeting — only this part.

Transcript part ${index + 1}/${total}:
${chunk}`;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: buildSystem(agenda),
    messages: [{ role: 'user', content: prompt }],
  });

  try {
    const parsed = parseJsonResponse(message);
    return {
      keyPoints: (parsed.keyPoints as string[]) || [],
      decisions: isFullAnalysis ? ((parsed.decisions as string[]) || []) : [],
      actionItems: isFullAnalysis ? ((parsed.actionItems as ActionItem[]) || []) : [],
    };
  } catch {
    // A single bad chunk shouldn't sink the whole summary.
    return { keyPoints: [], decisions: [], actionItems: [] };
  }
}

async function summarizeMapReduce(
  client: Anthropic,
  transcriptionText: string,
  isFullAnalysis: boolean,
  agenda?: string | null
): Promise<SummaryResult> {
  const chunks = chunkText(transcriptionText, CHUNK_SIZE);

  // MAP — extract notable content from each chunk (run with limited concurrency).
  const extracts: ChunkExtract[] = [];
  const CONCURRENCY = 3;
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((c, j) =>
        extractFromChunk(client, c, i + j, chunks.length, isFullAnalysis, agenda)
      )
    );
    extracts.push(...results);
  }

  const allKeyPoints = extracts.flatMap((e) => e.keyPoints);
  const allDecisions = extracts.flatMap((e) => e.decisions);
  const allActionItems = extracts.flatMap((e) => e.actionItems);

  // REDUCE — merge, dedupe, and write the executive summary from the extracts.
  const schema = isFullAnalysis
    ? `{
  "executiveSummary": "3-5 sentence overview of the entire meeting",
  "keyPoints": ["merged, deduped, most important points"],
  "decisions": ["merged, deduped decisions"],
  "actionItems": [{"action": "...", "owner": "name or null", "deadline": "deadline or null"}]
}`
    : `{
  "executiveSummary": "3-5 sentence overview of the entire meeting",
  "keyPoints": ["merged, deduped, most important points"]
}`;

  const reduceInput = isFullAnalysis
    ? JSON.stringify({ keyPoints: allKeyPoints, decisions: allDecisions, actionItems: allActionItems })
    : JSON.stringify({ keyPoints: allKeyPoints });

  const prompt = `These are notes extracted sequentially from the parts of one long meeting. Merge them into a single coherent set of notes: write an executive summary of the WHOLE meeting, then merge and de-duplicate the lists (keep them ordered by importance). Return ONLY valid JSON:
${schema}

Extracted notes:
${reduceInput}`;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: buildSystem(agenda),
    messages: [{ role: 'user', content: prompt }],
  });

  const parsed = parseJsonResponse(message);
  return {
    executiveSummary: (parsed.executiveSummary as string) || '',
    keyPoints: (parsed.keyPoints as string[]) || allKeyPoints,
    decisions: isFullAnalysis ? ((parsed.decisions as string[]) || allDecisions) : null,
    actionItems: isFullAnalysis ? ((parsed.actionItems as ActionItem[]) || allActionItems) : null,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function summarizeTranscription(
  apiKey: string,
  transcriptionText: string,
  processingLevel: ProcessingLevel,
  agenda?: string | null
): Promise<SummaryResult> {
  const client = new Anthropic({ apiKey });
  const isFullAnalysis = processingLevel === 'full_analysis';

  if (transcriptionText.length > MAP_REDUCE_THRESHOLD) {
    return summarizeMapReduce(client, transcriptionText, isFullAnalysis, agenda);
  }
  return summarizeSinglePass(client, transcriptionText, isFullAnalysis, agenda);
}
