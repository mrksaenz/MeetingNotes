# Plan: Robust Upload with Progress Bar for Large Recordings

## Problem Analysis

The current upload system has three core issues causing Mark's recordings to fail:

1. **Atomic single-request upload**: `uploadAudio()` sends the entire blob in one HTTP request via `supabase.storage.upload()`. For a 1-hour recording (~58MB at 128kbps), this is fragile on mobile connections — any interruption means starting over.

2. **No progress visibility**: The UI shows "Saving..." with no indication of progress. Users have no idea if the upload is 5% done or 95% done, so they assume it's broken.

3. **Retries restart from zero**: When the user hits "Retry" in the pending banner, the entire file re-uploads from byte 0. On a spotty connection, this means the same large file keeps failing at the same point.

## Solution: TUS Resumable Uploads

Supabase Storage natively supports the [TUS protocol](https://tus.io/) for resumable uploads. By switching to `tus-js-client`, we get:

- **Chunked uploads** — Large files sent in 6MB chunks instead of one giant request
- **Resumability** — If upload fails, it picks up from the last successful chunk (not from scratch)
- **Progress events** — `onProgress(bytesUploaded, bytesTotal)` callback for real-time progress bars
- **Built-in retries** — Configurable retry delays on chunk failure

At 128kbps audio, a 1-hour recording (~58MB) becomes ~10 chunks of 6MB. If chunk 7 fails, the retry resumes from chunk 7 — not chunk 1.

## Files to Change (5 existing + 1 new)

### 1. `web/package.json` — Add dependency
- Install `tus-js-client` (the standard TUS protocol client)

### 2. `web/src/lib/uploadAudio.ts` — Rewrite upload function
- Replace `supabase.storage.upload()` with TUS-based upload
- Add `onProgress` callback parameter: `(bytesUploaded: number, bytesTotal: number) => void`
- Configure: 6MB chunk size, retry delays `[0, 3000, 5000, 10000, 20000]`
- Use Supabase's TUS endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`
- Auth via user's access token in the `Authorization` header
- Support `abort()` to cancel in-flight uploads
- Use TUS fingerprinting for automatic resume of interrupted uploads
- Return a handle object: `{ promise, abort }` so callers can cancel

### 3. `web/src/components/recording/RecordingScreen.tsx` — Add progress bar during save
- Add `uploadProgress` state: `{ bytesUploaded: number, bytesTotal: number } | null`
- Pass `onProgress` callback to `uploadAudio()` that updates this state
- When `saving` is true and `uploadProgress` is set, render:
  - A progress bar (filled div proportional to percentage)
  - Text showing percentage and MB uploaded/total (e.g., "42% — 24 MB of 58 MB")
  - The existing "Saving..." button text changes to show percentage
- Replace the disabled "Saving..." button with a more informative saving state area

### 4. `web/src/hooks/usePendingUploads.ts` — Track progress per upload
- Add `uploadProgress` state: `Map<string, { bytesUploaded: number, bytesTotal: number }>`
- Pass `onProgress` to `uploadAudio()` during retries, updating the map
- Expose `uploadProgress` map in the return value
- Clear entry from map when upload completes or fails
- TUS auto-resume means retries pick up where they left off (no re-upload from zero)

### 5. `web/src/components/recording/PendingRecordingsBanner.tsx` — Show per-recording progress
- Accept `uploadProgress` map as a prop
- For each actively-uploading recording, show a progress bar instead of just "Syncing..."
- Display percentage and MB progress text
- The bar animates as chunks complete

### 6. NEW: `web/src/components/ui/UploadProgressBar.tsx` — Shared progress bar component
- Simple, reusable component used by both RecordingScreen and PendingRecordingsBanner
- Props: `bytesUploaded`, `bytesTotal`, optional `color`
- Renders: filled bar + percentage text + MB counter
- Minimal — just a styled div-in-div with text

## Implementation Details

### TUS Upload Configuration
```
Endpoint: ${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable
Chunk size: 6MB (6 * 1024 * 1024)
Retry delays: [0, 3000, 5000, 10000, 20000]
Headers: Authorization: Bearer ${access_token}, x-upsert: true
Metadata: bucketName, objectName, contentType, cacheControl
```

### Upload Function Signature Change
```typescript
// Before:
uploadAudio(userId, meetingId, partNumber, audioBlob): Promise<string | null>

// After:
uploadAudio(userId, meetingId, partNumber, audioBlob, options?: {
  onProgress?: (bytesUploaded: number, bytesTotal: number) => void;
}): { promise: Promise<string | null>; abort: () => void }
```

### Progress Bar UX
- Blue fill color matching the app's primary palette
- Smooth CSS transition on width changes (chunks arrive every few seconds)
- Shows "Uploading... 42%" during upload
- Shows "Finishing up..." after 100% (for the DB insert step)
- File size displayed as MB (e.g., "24 MB of 58 MB")

## What This Does NOT Change
- Recording flow (MediaRecorder, waveform, etc.) — untouched
- IndexedDB local backup — still saves locally first for safety
- Processing pipeline (AssemblyAI, Claude) — untouched
- Database schema — no migrations needed
- Supabase Storage bucket config — TUS is already supported server-side

## Rollout Risk
- Low risk: TUS is Supabase's recommended approach for large files
- `tus-js-client` is the official reference implementation (mature, well-tested)
- Fallback: if TUS fails for any reason, the error flow still saves to IndexedDB for retry
