'use client';

function formatMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

export default function UploadProgressBar({
  bytesUploaded,
  bytesTotal,
  label,
}: {
  bytesUploaded: number;
  bytesTotal: number;
  label?: string;
}) {
  const pct = bytesTotal > 0 ? Math.min(Math.round((bytesUploaded / bytesTotal) * 100), 100) : 0;

  return (
    <div className="w-full">
      {/* Label + percentage */}
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted">{label || 'Uploading...'}</span>
        <span className="tabular-nums font-medium text-foreground">{pct}%</span>
      </div>

      {/* Bar */}
      <div className="h-2 w-full overflow-hidden rounded-full bg-primary-100">
        <div
          className="h-full rounded-full bg-primary-500 transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Bytes counter */}
      <p className="mt-1 text-[11px] tabular-nums text-muted">
        {formatMB(bytesUploaded)} MB of {formatMB(bytesTotal)} MB
      </p>
    </div>
  );
}
