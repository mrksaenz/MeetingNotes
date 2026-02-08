# CLAUDE.md - Meeting Notes & Transcription App

## Project Overview
A cross-platform meeting notes application enabling audio recording, AI-powered transcription (AssemblyAI), speaker identification, and AI summarization (Claude Haiku 4.5). Users organize meetings across multiple workspaces representing different organizations.

## Tech Stack
- **Web Frontend:** Next.js 14 (App Router), Tailwind CSS, React Query + Zustand
- **Mobile:** React Native with Expo, NativeWind
- **Backend:** Supabase (PostgreSQL, Auth, Storage, Realtime, Edge Functions)
- **AI Services:** AssemblyAI Universal-2 (transcription), Anthropic Claude Haiku 4.5 (summarization)
- **Hosting:** Vercel
- **Audio:** MediaRecorder API (web), expo-av (mobile)

## Key Design Decisions
- Manual processing trigger (user controls when to spend AI tokens)
- Multi-part meeting support (recording chunks grouped under parent meeting)
- Three processing tiers: Transcription Only, Transcription + Summary, Full Analysis
- Shared links are public (anyone with link can view)

## Session Log

### Session 1 - February 8, 2026
- **Status:** PRD review and requirements clarification interview
- **Insights:** Project is brand new, empty repo. Starting from scratch.
- **Next Steps:** Complete requirements interview, then begin Phase 1 (Setup & Auth)

## Architecture Notes
_(To be filled as development progresses)_

## Lessons Learned
_(To be filled as development progresses)_

## Known Issues & Gotchas
_(To be filled as development progresses)_
