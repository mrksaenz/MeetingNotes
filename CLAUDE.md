# CLAUDE.md - Meeting Notes & Transcription App

## Project Overview
A responsive web application for meeting notes with audio recording, AI-powered transcription (AssemblyAI), speaker identification, and AI summarization (Claude Haiku 4.5). Users organize meetings across multiple workspaces representing different organizations.

## Tech Stack
- **Web Frontend:** Next.js 16 (App Router), Tailwind CSS v4, React Query + Zustand
- **Backend:** Supabase (PostgreSQL, Auth, Storage, Realtime, Edge Functions)
- **AI Services:** AssemblyAI Universal-2 (transcription), Anthropic Claude Haiku 4.5 (summarization)
- **Hosting:** Vercel
- **Audio:** MediaRecorder API (compressed WebM/Opus, MP3 fallback)

## Key Design Decisions
- **Single responsive web app** — no React Native. Phone records via mobile browser.
- Manual processing trigger (user controls when to spend AI tokens)
- Multi-part meeting support (recording chunks grouped under parent meeting) — MUST HAVE for MVP
- Three processing tiers: Transcription Only, Transcription + Summary, Full Analysis
- Cost display hidden from UI (internal tracking only)
- No paywall for MVP — usage tracking built in for future monetization
- Email/password auth only (Google OAuth deferred)
- English only (Spanish deferred)
- Sharing feature deferred
- Screen Wake Lock during recording — phone stays on showing waveform
- Consent reminder shown every time before recording starts
- Design: minimal/clean, blue-based palette, pops of color, NO purple

## MVP Scope
1. Select workspace
2. Record audio (with multi-part support)
3. Manually trigger AI processing (3 tiers)
4. Review transcription + summary

## Session Log

### Session 1 - February 8, 2026
- **Status:** PRD review and requirements clarification interview
- **Insights:** Project is brand new, empty repo. Starting from scratch.
- **Next Steps:** Complete requirements interview, then begin Phase 1 (Setup & Auth)

### Session 2 - February 9, 2026
- **Status:** Completed requirements interview + Phase 1 build
- **Key clarifications from Mark:**
  - Single responsive web app (no React Native)
  - Phone is primary recording device (mobile browser)
  - Email/password auth only for MVP
  - Compressed audio (WebM/Opus)
  - No paywall, no cost display, no sharing for MVP
  - Multi-part meetings are must-have (TBA Board meeting first real test)
  - Clean/minimal design with blue palette, pops of color, no purple
- **Built:**
  - Next.js 16 project with Tailwind CSS v4
  - Supabase client/server setup with SSR cookie handling
  - Auth middleware with route protection (redirects unauthenticated users)
  - Login, signup, password reset pages
  - Responsive dashboard: desktop sidebar + mobile bottom nav + mobile header
  - Workspace CRUD with color picker (6 colors)
  - Full database migration (001_initial_schema.sql) with:
    - All tables: workspaces, meetings, recording_parts, transcriptions, summaries, shared_links, usage_logs
    - Row Level Security (RLS) policies for all tables
    - Storage bucket for recordings with user-scoped policies
    - updated_at triggers
- **Next Steps:** Wire up recording functionality, deploy to Vercel

### Session 2 (continued) - February 9, 2026
- **Status:** Deployed to Vercel + built recording functionality
- **Vercel deployment fix:** 404 error caused by root directory not set. `vercel.json` does NOT support `rootDirectory` — must set it in Vercel dashboard (Settings → General → Root Directory → `web`).
- **Built (recording & multi-part meetings):**
  - Audio recording via MediaRecorder API (WebM/Opus, MP3 fallback)
  - Real-time waveform visualization using Canvas API + AnalyserNode
  - Screen Wake Lock API to keep phone screen on during recording
  - Consent reminder dialog before every recording
  - Pause/resume/stop controls with duration timer
  - Multi-part meeting support: new meetings or "Continue Meeting" flow
  - Audio upload to Supabase Storage (`recordings` bucket, user-scoped paths)
  - Meeting cards with nested parts list and processing status badges
  - Floating record button (mobile) + toolbar button (desktop)
  - Full-screen recording mode
- **Next Steps:** AI processing integration (AssemblyAI + Claude Haiku), transcription display

### Session 2 (continued, part 2) - February 9, 2026
- **Status:** Built full AI processing pipeline
- **Built:**
  - `/api/process` API route — server-side processing pipeline
  - AssemblyAI integration — submit audio URL, poll for completion, speaker diarization
  - Claude Haiku 4.5 integration — structured JSON summarization via Anthropic SDK
  - Processing trigger modal with 3-tier selection (transcription only / summary / full analysis)
  - Meeting detail view with:
    - Executive summary, key points, decisions, action items sections
    - Speaker-separated transcription with timestamps
    - Auto-polling (5s) while processing is in progress
  - Supabase service client for server-side ops (bypasses RLS)
  - Usage logging (tracks cost per processing action)
  - Clickable meeting cards → drill into detail view
- **Needs from Mark:** AssemblyAI API key, Anthropic API key, Supabase service role key
- **Next Steps:** Testing end-to-end with real API keys, mobile UX polish

### Session 2 (continued, part 3) - February 9, 2026
- **Status:** Fixed 500 error on `/api/process` route
- **Problem:** Processing failed with 500 error when user tried to process recordings
- **Root cause investigation:** Potential auth issues in API route + join query reliability
- **Fixes applied:**
  - Replaced imported `createClient` with inline `createServerClient` + explicit cookie handling in the API route (more reliable auth in API routes)
  - Split `recording_parts` + `meetings!inner` join query into two separate queries (avoids join-related failures with Supabase)
  - Added `export const maxDuration = 300` for Vercel Pro 5-minute timeout
  - Added `console.error` logging at each failure point for debugging
  - Return actual error messages instead of generic "Internal server error"
- **User action needed:** Reset failed recording parts' `processing_status` to `unprocessed` in Supabase dashboard, then retry processing
- **Next Steps:** Verify end-to-end processing works, mobile UX polish

### Session 3 - February 10, 2026
- **Status:** Fixed critical recording save bug + meetings not loading
- **Problem:** User recorded a 40-minute meeting on phone — recording was lost. App had zero resilience: audio blobs only existed in React memory state, no local backup, no retry, no user feedback (errors silently logged to console).
- **Root causes identified:**
  1. `handleSave` in RecordingScreen had 4 failure points that all did `console.error()` + `return`, permanently losing the audio blob
  2. `fetchMeetings` had `supabase` in its `useCallback` dependency causing unstable references
  3. `fetchMeetings` query filtered on `is_archived` column (migration 002) which hadn't been run in production DB
  4. No toast/notification system existed — users never saw success or failure messages
- **Built (recording reliability + toast system):**
  - IndexedDB recording store (`recordingStore.ts`) — saves audio blobs locally before upload attempt
  - Toast notification system (`ToastContext` + `Toast.tsx` + `Providers.tsx`) — slide-up toasts with success/error/info types
  - Rewrote RecordingScreen save flow: IndexedDB first → attempt upload → toast result → never lose data
  - Pending uploads recovery hook (`usePendingUploads.ts`) — auto-retries on app load and on `online` event with exponential backoff
  - Pending recordings banner on dashboard with per-item retry/discard
  - Made `uploadAudio` retry-safe (`upsert: true`)
  - Fixed `fetchMeetings`: moved `createClient()` inside callback (stable `[]` deps), added `refreshTrigger` state, added `is_archived` fallback query, added error logging
- **Migration reminder:** `002_add_is_archived.sql` must be run manually in Supabase SQL Editor
- **Next Steps:** Mark testing for the rest of the week, then continue with mobile UX polish

### Session 4 - February 17, 2026
- **Status:** Added export to PDF/DOCX and speaker rename features
- **Features built:**
  - **Speaker Rename Workflow:**
    - Added `speaker_labels` JSONB column to `meetings` table (migration 004)
    - Speaker labels panel appears above transcription parts when multiple speakers are detected
    - Click any speaker chip to inline-edit the name (e.g., "Speaker A" → "Mark Saenz")
    - Changes save to database immediately and update all occurrences in the transcription view
    - Speaker names carry through to PDF/DOCX exports
  - **Export to PDF/DOCX:**
    - Export dropdown button appears in meeting detail header when transcriptions exist
    - PDF export via `jsPDF` — clean A4 layout with title, date, summary sections, bullet lists, and speaker-colored transcription
    - DOCX export via `docx` package — fully editable Word document with headings, bullet lists, bold speaker names, and proper formatting
    - Both formats include: executive summary, key points, decisions, action items, and full speaker-labeled transcription
    - Filenames auto-generated from meeting title (sanitized)
- **New dependencies:** `docx`, `jspdf`, `file-saver`, `@types/file-saver`
- **Migration reminder:** `004_add_speaker_labels.sql` must be run manually in Supabase SQL Editor
- **Next Steps:** Test with real meeting data, mobile UX polish

## Architecture Notes
- `web/` — Next.js app (all frontend + API routes)
- `supabase/migrations/` — SQL migrations (run manually in Supabase SQL Editor)
- Supabase SSR uses `@supabase/ssr` with cookie-based session management
- Middleware handles auth redirects: unauthenticated → /auth/login, authenticated → /dashboard
- RLS policies enforce data isolation: users only see their own data
- Recording parts linked to meetings via foreign key; transcriptions linked to parts; summaries linked to transcriptions

## Component Architecture
- `useAudioRecorder` hook — MediaRecorder + AnalyserNode, returns state/duration/waveformData/blob
- `useWakeLock` hook — Screen Wake Lock API, auto-releases on cleanup
- `usePendingUploads` hook — Checks IndexedDB for pending recordings, auto-retries on mount + `online` event, exponential backoff
- `Waveform` component — Canvas-based, renders amplitude bars from audio analysis data
- `RecordingScreen` — Full-screen recording UI with consent → record → save flow (IndexedDB-first)
- `MeetingCard` — Shows meeting with nested parts, status badges, continue button
- `PendingRecordingsBanner` — Amber banner showing locally-saved recordings with Retry/Discard buttons
- `uploadAudio()` — Uploads blob to Supabase Storage at `{userId}/{meetingId}/part_{n}.{ext}` (upsert: true for retry safety)
- `recordingStore.ts` — IndexedDB wrapper: `saveRecordingLocally()`, `getPendingRecordings()`, `updateRecordingStatus()`, `deleteLocalRecording()`
- `ToastContext` + `Toast.tsx` — Toast notification system, accessible via `useToast()` hook
- `Providers.tsx` — Client component wrapper keeping layout.tsx as server component
- `MeetingDetail` — Full meeting view with transcription/summary display, process button, auto-poll, speaker rename panel, export dropdown
- `exportMeeting.ts` — Client-side export utilities: `exportToPdf()` (jsPDF) and `exportToDocx()` (docx package) with speaker label support
- `ProcessModal` — 3-tier processing selector (transcription only / summary / full analysis)
- `/api/process` route — Server-side: auth → signed URL → AssemblyAI → Claude Haiku → save to DB
- `transcribeAudio()` — AssemblyAI: submit job, poll 5s intervals, return text + utterances
- `summarizeTranscription()` — Claude Haiku: structured JSON output (summary, key points, decisions, actions)

## Lessons Learned
- Next.js 16 (create-next-app@latest) now uses Turbopack by default and has deprecated `middleware.ts` in favor of `proxy` convention — but middleware still works
- Google Fonts fail in environments without internet access — use system fonts as fallback
- `.gitignore` pattern `.env*` also catches `.env.example` — need `!.env.example` exception
- Tailwind CSS v4 uses `@theme inline` blocks instead of `tailwind.config.js` for custom theming
- `vercel.json` does NOT support `rootDirectory` property — must be set in Vercel dashboard only
- MediaRecorder MIME type support varies: check `isTypeSupported()` and fallback gracefully

## Lessons Learned (AI Processing)
- AssemblyAI polling can take minutes for long recordings — UI auto-polls every 5s
- Claude Haiku JSON output sometimes includes markdown code blocks — strip them before parsing
- Supabase service role client needed for server-side ops that bypass RLS
- Processing runs synchronously in the API route — works for MVP but may need queue for scale
- In Next.js API routes, prefer inline `createServerClient` with explicit cookie handling over imported server client — more reliable for auth
- Supabase join queries (`!inner`) can fail silently — splitting into separate queries is more debuggable
- Always return actual error messages from API routes during development (not just "Internal server error") to speed debugging
- AssemblyAI API now requires explicit `speech_models` parameter (array) — e.g. `speech_models: ['universal-2']`. Omitting it causes a validation error. Valid options: `"universal-3-pro"`, `"universal-2"`

## Lessons Learned (Recording Reliability)
- Audio blobs in React state are ephemeral — ALWAYS persist to IndexedDB before attempting network operations
- IndexedDB handles large Blobs natively (hundreds of MB) — far better than localStorage (5MB limit) for audio
- `createBrowserClient` from `@supabase/ssr` may or may not return a singleton depending on version — don't rely on it for `useCallback` dependencies. Call `createClient()` inside the callback instead and use `[]` deps
- Supabase queries fail silently if you filter on a column that doesn't exist (missing migration) — always add error logging and consider fallback queries
- Use a `refreshTrigger` counter state in `useEffect` dependencies to force re-fetches after async operations complete — more reliable than depending on callback references
- `uploadAudio` should use `upsert: true` so retries don't fail on duplicate files in Supabase Storage
- Save the `meetingId` to IndexedDB immediately after meeting creation — prevents duplicate meetings on retry
- Check for existing `recording_parts` rows before inserting during retry — prevents duplicate parts
- Browser `online` event is a good trigger for retrying failed uploads — user records at venue, drives home, opens app on Wi-Fi

## Known Issues & Gotchas
- Next.js 16 shows deprecation warning for middleware.ts — works fine, can migrate to proxy convention later
- Database migration must be run manually in Supabase SQL Editor (no CLI in this env)
- Wake Lock API not supported on all browsers — fails silently, recording still works
- API route timeout on Vercel is 60s (Hobby) / 300s (Pro) — long recordings may need background processing
- If `is_archived` column doesn't exist (migration 002 not run), `fetchMeetings` falls back to query without that filter — archive feature won't work but meetings will still load
