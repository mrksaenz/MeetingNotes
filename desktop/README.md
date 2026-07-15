# MeetingNotes for Mac

A standalone Mac app for meeting notes — record or upload audio, get AI
transcription (AssemblyAI) with speaker labels, AI summaries (Claude), and
export clean PDF/Word notes.

**There is no database and no server.** Every meeting is a plain folder inside
a "meetings folder" you choose. Point that folder at Google Drive for Desktop
and everything — audio, transcripts, summaries, and exported PDFs — syncs
automatically and is instantly available to whoever runs the app next.

## How data is stored

```
<Meetings folder>            ← pick a folder inside Google Drive
  2026-07-15 TBA Board Meeting/
    meeting.json             ← title, agenda, transcripts, summary, speaker names
    audio/part-01.m4a        ← original recordings / uploaded voice memos
    exports/
      TBA_Board_Meeting_notes.pdf
      TBA_Board_Meeting_notes.docx
```

Deleting a meeting in the app moves its folder to the Trash — nothing is ever
hard-deleted.

## Handing off to the next secretary

1. Share the meetings folder in Google Drive with the new secretary (or hand
   over the shared Drive account).
2. They install MeetingNotes and, on first launch, point it at the same
   folder inside their Google Drive for Desktop.
3. They enter the organization's AssemblyAI and Anthropic API keys (keys are
   stored encrypted on each Mac, never inside the synced folder).

That's it — the full meeting history appears in the app.

## Building the app (developer)

Requires Node.js 20+ on a Mac.

```bash
cd desktop
npm install
npm run dev        # run in development
npm run typecheck  # typecheck main + renderer
npm run dist       # build MeetingNotes-<version>-<arch>.dmg into dist/
```

The `.dmg` in `dist/` is what you give to users. The build is unsigned by
default; on first launch users may need to right-click → Open (or approve it
under System Settings → Privacy & Security). For wider distribution, add an
Apple Developer ID and notarization to `electron-builder.yml`.

## First-run checklist for a new Mac

1. Install Google Drive for Desktop and sign in (the meetings folder appears
   under `~/Library/CloudStorage/GoogleDrive-…/My Drive/…`).
2. Open MeetingNotes → choose that folder → paste the two API keys.
3. When you first record, macOS will ask for microphone permission — allow it.

## Features

- **Record** with the Mac's microphone (consent reminder, pause/resume,
  live waveform). Recordings save into the meeting folder before anything
  else happens — nothing is lost if the network is down.
- **Upload voice memos** (m4a/mp3/wav/…) from a phone; multiple files become
  multi-part meetings.
- **Paste an existing transcript** (plain text, `Speaker: text`, WebVTT, SRT)
  — skips transcription entirely, so summarizing is the only AI cost.
- **Agenda-aware summaries**: paste the agenda when creating the meeting and
  the AI organizes decisions/action items around it.
- **Three processing tiers**: transcription only / + summary / full analysis
  (decisions + action items with owners).
- **Long meetings** (e.g. 5-hour board meetings) are summarized with a
  map-reduce pipeline so they never exceed model limits.
- **Speaker rename**: click a speaker chip to replace "Speaker A" with a real
  name; names flow into the transcript view and all exports.
- **Export PDF / Word** into the meeting's `exports/` folder (i.e. straight
  into Google Drive) — the file is revealed in Finder after export.
