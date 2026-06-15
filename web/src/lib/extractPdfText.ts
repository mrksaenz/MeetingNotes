/**
 * Extract plain text from a PDF in the browser using pdf.js.
 *
 * Used for uploading board agendas and transcripts that arrive as PDFs.
 * Loaded via dynamic import so pdf.js (and its worker) stay out of the main
 * bundle and never run during SSR.
 */
export async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');

  // Resolve the worker as a bundled asset (works with Turbopack/webpack).
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();

  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;

  let text = '';
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if ('str' in item) {
        text += item.str;
        // Preserve line breaks so "Speaker: ..." lines survive for the parser.
        text += item.hasEOL ? '\n' : ' ';
      }
    }
    text += '\n\n';
  }

  return text.trim();
}
