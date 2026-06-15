import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } from 'docx';
import { jsPDF } from 'jspdf';
import { saveAs } from 'file-saver';
import type { Meeting, RecordingPart, Transcription, Summary } from '@/types/database';

interface TranscriptionWithSummary extends Transcription {
  summaries: Summary[];
}

interface ExportData {
  meeting: Meeting & { recording_parts: RecordingPart[] };
  transcriptions: Map<string, TranscriptionWithSummary>;
  speakerLabels: Record<string, string>;
}

function getSpeakerName(speaker: string, labels: Record<string, string>): string {
  return labels[speaker] || `Speaker ${speaker}`;
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatPdfDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ─── DOCX Export ────────────────────────────────────────────────────────────

export async function exportToDocx({ meeting, transcriptions, speakerLabels }: ExportData) {
  const children: Paragraph[] = [];

  // Title (cover)
  children.push(
    new Paragraph({
      text: meeting.title,
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
    })
  );

  // Date & metadata
  const docTotalSeconds = meeting.recording_parts.reduce((s, p) => s + (p.duration_seconds || 0), 0);
  const metaRuns = [
    new TextRun({ text: formatDate(meeting.recorded_at), color: '666666', size: 20 }),
    new TextRun({ text: `   |   ${meeting.recording_parts.length} part${meeting.recording_parts.length !== 1 ? 's' : ''}`, color: '666666', size: 20 }),
  ];
  if (docTotalSeconds > 0) {
    metaRuns.push(new TextRun({ text: `   |   ${formatPdfDuration(docTotalSeconds)}`, color: '666666', size: 20 }));
  }
  children.push(
    new Paragraph({
      children: metaRuns,
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
    })
  );

  // Separator
  children.push(
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' } },
      spacing: { after: 200 },
    })
  );

  // Agenda
  if (meeting.agenda_text && meeting.agenda_text.trim()) {
    children.push(
      new Paragraph({
        text: 'Agenda',
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 100, after: 100 },
      })
    );
    for (const line of meeting.agenda_text.trim().split(/\r?\n/)) {
      children.push(new Paragraph({ text: line, spacing: { after: 40 } }));
    }
  }

  // Process each part
  for (const part of meeting.recording_parts) {
    const transcription = transcriptions.get(part.id);
    if (!transcription) continue;

    const summary = transcription.summaries?.[0];

    if (meeting.recording_parts.length > 1) {
      children.push(
        new Paragraph({
          text: `Part ${part.part_number}`,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 200 },
        })
      );
    }

    // Executive Summary
    if (summary?.executive_summary) {
      children.push(
        new Paragraph({
          text: 'Summary',
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 100 },
        })
      );
      children.push(
        new Paragraph({
          text: summary.executive_summary,
          spacing: { after: 200 },
        })
      );
    }

    // Key Points
    if (summary?.key_points && summary.key_points.length > 0) {
      children.push(
        new Paragraph({
          text: 'Key Points',
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 100 },
        })
      );
      for (const point of summary.key_points) {
        children.push(
          new Paragraph({
            text: point,
            bullet: { level: 0 },
            spacing: { after: 60 },
          })
        );
      }
    }

    // Decisions
    if (summary?.decisions && summary.decisions.length > 0) {
      children.push(
        new Paragraph({
          text: 'Decisions',
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 100 },
        })
      );
      for (const decision of summary.decisions) {
        children.push(
          new Paragraph({
            text: decision,
            bullet: { level: 0 },
            spacing: { after: 60 },
          })
        );
      }
    }

    // Action Items
    if (summary?.action_items && summary.action_items.length > 0) {
      children.push(
        new Paragraph({
          text: 'Action Items',
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 100 },
        })
      );
      for (const item of summary.action_items) {
        const actionText = typeof item === 'string' ? item : item.action;
        const meta: string[] = [];
        if (typeof item !== 'string') {
          if (item.owner) meta.push(`Owner: ${item.owner}`);
          if (item.deadline) meta.push(`Due: ${item.deadline}`);
        }
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${actionText}`, bold: true }),
              ...(meta.length > 0 ? [new TextRun({ text: `  (${meta.join(', ')})`, italics: true, color: '666666' })] : []),
            ],
            bullet: { level: 0 },
            spacing: { after: 60 },
          })
        );
      }
    }

    // Transcription
    if (transcription.speakers && transcription.speakers.length > 0) {
      children.push(
        new Paragraph({
          text: 'Transcription',
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 300, after: 100 },
        })
      );
      for (const utterance of transcription.speakers) {
        const name = getSpeakerName(utterance.speaker, speakerLabels);
        const timestamp = 'start' in utterance && typeof utterance.start === 'number'
          ? ` [${formatTimestamp(utterance.start)}]`
          : '';
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${name}${timestamp}:  `, bold: true, color: '2563EB' }),
              new TextRun({ text: utterance.text }),
            ],
            spacing: { after: 120 },
          })
        );
      }
    } else if (transcription.full_text) {
      children.push(
        new Paragraph({
          text: 'Transcription',
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 300, after: 100 },
        })
      );
      children.push(
        new Paragraph({
          text: transcription.full_text,
          spacing: { after: 200 },
        })
      );
    }
  }

  const doc = new Document({
    sections: [{ children }],
    creator: 'MeetingNotes',
    title: meeting.title,
  });

  const blob = await Packer.toBlob(doc);
  const filename = `${meeting.title.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_')}_notes.docx`;
  saveAs(blob, filename);
}

// ─── PDF Export ─────────────────────────────────────────────────────────────

export function exportToPdf({ meeting, transcriptions, speakerLabels }: ExportData) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  function checkPageBreak(needed: number) {
    if (y + needed > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  }

  function addText(text: string, fontSize: number, options?: { bold?: boolean; color?: [number, number, number]; indent?: number }) {
    const indent = options?.indent || 0;
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', options?.bold ? 'bold' : 'normal');
    if (options?.color) {
      doc.setTextColor(...options.color);
    } else {
      doc.setTextColor(30, 30, 30);
    }
    const lines = doc.splitTextToSize(text, contentWidth - indent);
    const lineHeight = fontSize * 0.45;
    for (const line of lines) {
      checkPageBreak(lineHeight + 2);
      doc.text(line, margin + indent, y);
      y += lineHeight;
    }
    y += 2;
  }

  // ── Cover header ──────────────────────────────────────────────────────
  // Blue band across the top with the meeting title in white.
  const bandHeight = 34;
  doc.setFillColor(37, 99, 235); // primary blue
  doc.rect(0, 0, pageWidth, bandHeight, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  const titleLines = doc.splitTextToSize(meeting.title, contentWidth);
  let titleY = 16;
  for (const line of titleLines.slice(0, 2)) {
    doc.text(line, margin, titleY);
    titleY += 8;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const dateStr = formatDate(meeting.recorded_at);
  const partCount = `${meeting.recording_parts.length} part${meeting.recording_parts.length !== 1 ? 's' : ''}`;
  const totalSeconds = meeting.recording_parts.reduce((s, p) => s + (p.duration_seconds || 0), 0);
  const meta = [dateStr, partCount, totalSeconds > 0 ? formatPdfDuration(totalSeconds) : '']
    .filter(Boolean)
    .join('   |   ');
  doc.text(meta, margin, bandHeight - 6);

  y = bandHeight + 12;

  // Agenda
  if (meeting.agenda_text && meeting.agenda_text.trim()) {
    addText('AGENDA', 9, { bold: true, color: [100, 100, 100] });
    addText(meeting.agenda_text.trim(), 10);
    y += 3;
  }

  // Process each part
  for (const part of meeting.recording_parts) {
    const transcription = transcriptions.get(part.id);
    if (!transcription) continue;

    const summary = transcription.summaries?.[0];

    if (meeting.recording_parts.length > 1) {
      checkPageBreak(12);
      addText(`Part ${part.part_number}`, 14, { bold: true });
      y += 2;
    }

    // Executive Summary
    if (summary?.executive_summary) {
      checkPageBreak(10);
      addText('SUMMARY', 9, { bold: true, color: [100, 100, 100] });
      addText(summary.executive_summary, 10);
      y += 3;
    }

    // Key Points
    if (summary?.key_points && summary.key_points.length > 0) {
      checkPageBreak(10);
      addText('KEY POINTS', 9, { bold: true, color: [100, 100, 100] });
      for (const point of summary.key_points) {
        checkPageBreak(6);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(30, 30, 30);
        doc.text('\u2022', margin + 2, y);
        const lines = doc.splitTextToSize(point, contentWidth - 8);
        const lineHeight = 10 * 0.45;
        for (const line of lines) {
          checkPageBreak(lineHeight + 1);
          doc.text(line, margin + 8, y);
          y += lineHeight;
        }
        y += 1;
      }
      y += 3;
    }

    // Decisions
    if (summary?.decisions && summary.decisions.length > 0) {
      checkPageBreak(10);
      addText('DECISIONS', 9, { bold: true, color: [100, 100, 100] });
      for (const decision of summary.decisions) {
        checkPageBreak(6);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(30, 30, 30);
        doc.text('\u2022', margin + 2, y);
        const lines = doc.splitTextToSize(decision, contentWidth - 8);
        const lineHeight = 10 * 0.45;
        for (const line of lines) {
          checkPageBreak(lineHeight + 1);
          doc.text(line, margin + 8, y);
          y += lineHeight;
        }
        y += 1;
      }
      y += 3;
    }

    // Action Items
    if (summary?.action_items && summary.action_items.length > 0) {
      checkPageBreak(10);
      addText('ACTION ITEMS', 9, { bold: true, color: [100, 100, 100] });
      for (const item of summary.action_items) {
        const actionText = typeof item === 'string' ? item : item.action;
        checkPageBreak(8);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 30, 30);
        doc.text('\u2022', margin + 2, y);
        const lines = doc.splitTextToSize(actionText, contentWidth - 8);
        const lineHeight = 10 * 0.45;
        for (const line of lines) {
          checkPageBreak(lineHeight + 1);
          doc.text(line, margin + 8, y);
          y += lineHeight;
        }
        if (typeof item !== 'string' && (item.owner || item.deadline)) {
          const meta: string[] = [];
          if (item.owner) meta.push(`Owner: ${item.owner}`);
          if (item.deadline) meta.push(`Due: ${item.deadline}`);
          doc.setFont('helvetica', 'italic');
          doc.setTextColor(100, 100, 100);
          doc.setFontSize(9);
          checkPageBreak(5);
          doc.text(meta.join('  |  '), margin + 8, y);
          y += 4;
        }
        y += 1;
      }
      y += 3;
    }

    // Start the full transcript on a fresh page when notes preceded it, so the
    // summary/decisions/action items read as a clean cover section.
    const hasNotes = !!(summary?.executive_summary || summary?.key_points?.length ||
      summary?.decisions?.length || summary?.action_items?.length);

    // Transcription
    if (transcription.speakers && transcription.speakers.length > 0) {
      if (hasNotes) { doc.addPage(); y = margin; }
      checkPageBreak(10);
      addText('TRANSCRIPTION', 9, { bold: true, color: [100, 100, 100] });
      y += 2;

      for (const utterance of transcription.speakers) {
        const name = getSpeakerName(utterance.speaker, speakerLabels);
        const timestamp = 'start' in utterance && typeof utterance.start === 'number'
          ? ` [${formatTimestamp(utterance.start)}]`
          : '';

        checkPageBreak(10);

        // Speaker name
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(37, 99, 235);
        doc.text(`${name}${timestamp}`, margin, y);
        y += 4;

        // Utterance text
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(30, 30, 30);
        const lines = doc.splitTextToSize(utterance.text, contentWidth);
        const lineHeight = 10 * 0.45;
        for (const line of lines) {
          checkPageBreak(lineHeight + 1);
          doc.text(line, margin, y);
          y += lineHeight;
        }
        y += 3;
      }
    } else if (transcription.full_text) {
      if (hasNotes) { doc.addPage(); y = margin; }
      checkPageBreak(10);
      addText('TRANSCRIPTION', 9, { bold: true, color: [100, 100, 100] });
      addText(transcription.full_text, 10);
    }
  }

  const filename = `${meeting.title.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_')}_notes.pdf`;
  doc.save(filename);
}
