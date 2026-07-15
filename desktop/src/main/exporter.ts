import { promises as fs } from 'fs';
import path from 'path';
import { jsPDF } from 'jspdf';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } from 'docx';
import type { ExportFormat, ExportResult, Meeting } from '@shared/types';
import { getMeeting, exportsDir } from './library';

/**
 * PDF/DOCX export, ported from web/src/lib/exportMeeting.ts. Instead of a
 * browser download, files are written into the meeting's exports/ folder —
 * which lives inside the library (Google Drive) folder, so exports sync
 * automatically without any Drive API integration.
 */

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

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function baseFileName(meeting: Meeting): string {
  return `${meeting.title.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_') || 'meeting'}_notes`;
}

async function writeExport(meeting: Meeting, fileName: string, data: Buffer): Promise<ExportResult> {
  const dir = await exportsDir(meeting.id);
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, data);
  return { path: filePath, fileName };
}

export async function exportMeeting(meetingId: string, format: ExportFormat): Promise<ExportResult> {
  const meeting = await getMeeting(meetingId);
  if (format === 'pdf') return exportToPdf(meeting);
  return exportToDocx(meeting);
}

// ─── DOCX Export ────────────────────────────────────────────────────────────

async function exportToDocx(meeting: Meeting): Promise<ExportResult> {
  const speakerLabels = meeting.speakerLabels;
  const summary = meeting.summary;
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
  const totalSeconds = meeting.parts.reduce((s, p) => s + (p.durationSeconds || 0), 0);
  const metaRuns = [
    new TextRun({ text: formatDate(meeting.recordedAt), color: '666666', size: 20 }),
    new TextRun({ text: `   |   ${meeting.parts.length} part${meeting.parts.length !== 1 ? 's' : ''}`, color: '666666', size: 20 }),
  ];
  if (totalSeconds > 0) {
    metaRuns.push(new TextRun({ text: `   |   ${formatDuration(totalSeconds)}`, color: '666666', size: 20 }));
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
  if (meeting.agendaText?.trim()) {
    children.push(
      new Paragraph({
        text: 'Agenda',
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 100, after: 100 },
      })
    );
    for (const line of meeting.agendaText.trim().split(/\r?\n/)) {
      children.push(new Paragraph({ text: line, spacing: { after: 40 } }));
    }
  }

  // Meeting-level summary sections
  if (summary?.executiveSummary) {
    children.push(
      new Paragraph({ text: 'Summary', heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 100 } })
    );
    children.push(new Paragraph({ text: summary.executiveSummary, spacing: { after: 200 } }));
  }

  if (summary?.keyPoints && summary.keyPoints.length > 0) {
    children.push(
      new Paragraph({ text: 'Key Points', heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 100 } })
    );
    for (const point of summary.keyPoints) {
      children.push(new Paragraph({ text: point, bullet: { level: 0 }, spacing: { after: 60 } }));
    }
  }

  if (summary?.decisions && summary.decisions.length > 0) {
    children.push(
      new Paragraph({ text: 'Decisions', heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 100 } })
    );
    for (const decision of summary.decisions) {
      children.push(new Paragraph({ text: decision, bullet: { level: 0 }, spacing: { after: 60 } }));
    }
  }

  if (summary?.actionItems && summary.actionItems.length > 0) {
    children.push(
      new Paragraph({ text: 'Action Items', heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 100 } })
    );
    for (const item of summary.actionItems) {
      const meta: string[] = [];
      if (item.owner) meta.push(`Owner: ${item.owner}`);
      if (item.deadline) meta.push(`Due: ${item.deadline}`);
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: item.action, bold: true }),
            ...(meta.length > 0 ? [new TextRun({ text: `  (${meta.join(', ')})`, italics: true, color: '666666' })] : []),
          ],
          bullet: { level: 0 },
          spacing: { after: 60 },
        })
      );
    }
  }

  // Per-part transcriptions
  for (const part of meeting.parts) {
    const transcription = part.transcription;
    if (!transcription) continue;

    if (meeting.parts.length > 1) {
      children.push(
        new Paragraph({
          text: `Part ${part.partNumber}`,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 200 },
        })
      );
    }

    if (transcription.utterances && transcription.utterances.length > 0) {
      children.push(
        new Paragraph({ text: 'Transcription', heading: HeadingLevel.HEADING_3, spacing: { before: 300, after: 100 } })
      );
      for (const utterance of transcription.utterances) {
        const name = getSpeakerName(utterance.speaker, speakerLabels);
        const timestamp = typeof utterance.start === 'number' && utterance.start > 0
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
    } else if (transcription.fullText) {
      children.push(
        new Paragraph({ text: 'Transcription', heading: HeadingLevel.HEADING_3, spacing: { before: 300, after: 100 } })
      );
      children.push(new Paragraph({ text: transcription.fullText, spacing: { after: 200 } }));
    }
  }

  const doc = new Document({
    sections: [{ children }],
    creator: 'MeetingNotes',
    title: meeting.title,
  });

  const buffer = await Packer.toBuffer(doc);
  return writeExport(meeting, `${baseFileName(meeting)}.docx`, Buffer.from(buffer));
}

// ─── PDF Export ─────────────────────────────────────────────────────────────

async function exportToPdf(meeting: Meeting): Promise<ExportResult> {
  const speakerLabels = meeting.speakerLabels;
  const summary = meeting.summary;

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

  function addBulletList(items: string[], bold = false) {
    for (const item of items) {
      checkPageBreak(6);
      doc.setFontSize(10);
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setTextColor(30, 30, 30);
      doc.text('•', margin + 2, y);
      const lines = doc.splitTextToSize(item, contentWidth - 8);
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

  // ── Cover header — blue band with the meeting title in white ──────────
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
  const totalSeconds = meeting.parts.reduce((s, p) => s + (p.durationSeconds || 0), 0);
  const meta = [
    formatDate(meeting.recordedAt),
    `${meeting.parts.length} part${meeting.parts.length !== 1 ? 's' : ''}`,
    totalSeconds > 0 ? formatDuration(totalSeconds) : '',
  ]
    .filter(Boolean)
    .join('   |   ');
  doc.text(meta, margin, bandHeight - 6);

  y = bandHeight + 12;

  // Agenda
  if (meeting.agendaText?.trim()) {
    addText('AGENDA', 9, { bold: true, color: [100, 100, 100] });
    addText(meeting.agendaText.trim(), 10);
    y += 3;
  }

  // Meeting-level summary sections
  if (summary?.executiveSummary) {
    checkPageBreak(10);
    addText('SUMMARY', 9, { bold: true, color: [100, 100, 100] });
    addText(summary.executiveSummary, 10);
    y += 3;
  }

  if (summary?.keyPoints && summary.keyPoints.length > 0) {
    checkPageBreak(10);
    addText('KEY POINTS', 9, { bold: true, color: [100, 100, 100] });
    addBulletList(summary.keyPoints);
  }

  if (summary?.decisions && summary.decisions.length > 0) {
    checkPageBreak(10);
    addText('DECISIONS', 9, { bold: true, color: [100, 100, 100] });
    addBulletList(summary.decisions);
  }

  if (summary?.actionItems && summary.actionItems.length > 0) {
    checkPageBreak(10);
    addText('ACTION ITEMS', 9, { bold: true, color: [100, 100, 100] });
    for (const item of summary.actionItems) {
      checkPageBreak(8);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 30, 30);
      doc.text('•', margin + 2, y);
      const lines = doc.splitTextToSize(item.action, contentWidth - 8);
      const lineHeight = 10 * 0.45;
      for (const line of lines) {
        checkPageBreak(lineHeight + 1);
        doc.text(line, margin + 8, y);
        y += lineHeight;
      }
      if (item.owner || item.deadline) {
        const itemMeta: string[] = [];
        if (item.owner) itemMeta.push(`Owner: ${item.owner}`);
        if (item.deadline) itemMeta.push(`Due: ${item.deadline}`);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(100, 100, 100);
        doc.setFontSize(9);
        checkPageBreak(5);
        doc.text(itemMeta.join('  |  '), margin + 8, y);
        y += 4;
      }
      y += 1;
    }
    y += 3;
  }

  // Start the full transcript on a fresh page when notes preceded it, so the
  // summary/decisions/action items read as a clean cover section.
  const hasNotes = !!(summary?.executiveSummary || summary?.keyPoints?.length ||
    summary?.decisions?.length || summary?.actionItems?.length);
  let firstTranscript = true;

  for (const part of meeting.parts) {
    const transcription = part.transcription;
    if (!transcription) continue;

    if (firstTranscript && hasNotes) {
      doc.addPage();
      y = margin;
    }
    firstTranscript = false;

    if (meeting.parts.length > 1) {
      checkPageBreak(12);
      addText(`Part ${part.partNumber}`, 14, { bold: true });
      y += 2;
    }

    if (transcription.utterances && transcription.utterances.length > 0) {
      checkPageBreak(10);
      addText('TRANSCRIPTION', 9, { bold: true, color: [100, 100, 100] });
      y += 2;

      for (const utterance of transcription.utterances) {
        const name = getSpeakerName(utterance.speaker, speakerLabels);
        const timestamp = typeof utterance.start === 'number' && utterance.start > 0
          ? ` [${formatTimestamp(utterance.start)}]`
          : '';

        checkPageBreak(10);

        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(37, 99, 235);
        doc.text(`${name}${timestamp}`, margin, y);
        y += 4;

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
    } else if (transcription.fullText) {
      checkPageBreak(10);
      addText('TRANSCRIPTION', 9, { bold: true, color: [100, 100, 100] });
      addText(transcription.fullText, 10);
    }
  }

  const data = Buffer.from(doc.output('arraybuffer'));
  return writeExport(meeting, `${baseFileName(meeting)}.pdf`, data);
}
