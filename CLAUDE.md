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
- `Waveform` component — Canvas-based, renders amplitude bars from audio analysis data
- `RecordingScreen` — Full-screen recording UI with consent → record → save flow
- `MeetingCard` — Shows meeting with nested parts, status badges, continue button
- `uploadAudio()` — Uploads blob to Supabase Storage at `{userId}/{meetingId}/part_{n}.{ext}`

## Lessons Learned
- Next.js 16 (create-next-app@latest) now uses Turbopack by default and has deprecated `middleware.ts` in favor of `proxy` convention — but middleware still works
- Google Fonts fail in environments without internet access — use system fonts as fallback
- `.gitignore` pattern `.env*` also catches `.env.example` — need `!.env.example` exception
- Tailwind CSS v4 uses `@theme inline` blocks instead of `tailwind.config.js` for custom theming
- `vercel.json` does NOT support `rootDirectory` property — must be set in Vercel dashboard only
- MediaRecorder MIME type support varies: check `isTypeSupported()` and fallback gracefully

## Known Issues & Gotchas
- Next.js 16 shows deprecation warning for middleware.ts — works fine, can migrate to proxy convention later
- Database migration must be run manually in Supabase SQL Editor (no CLI in this env)
- Wake Lock API not supported on all browsers — fails silently, recording still works
