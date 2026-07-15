import { useEffect, useRef, useState } from 'react';
import { useToast } from '../lib/toast';

type RecState = 'consent' | 'recording' | 'paused' | 'saving';

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

function formatTimer(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default function RecordScreen({
  meetingId,
  meetingTitle,
  onDone,
}: {
  meetingId: string;
  meetingTitle: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const [state, setState] = useState<RecState>('consent');
  const [seconds, setSeconds] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function cleanup() {
    cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  useEffect(() => cleanup, []);

  function drawWaveform() {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d')!;
    const data = new Uint8Array(analyser.frequencyBinCount);

    function frame() {
      if (!analyserRef.current) return;
      analyserRef.current.getByteFrequencyData(data);
      const { width, height } = canvas!;
      ctx.clearRect(0, 0, width, height);
      const bars = 48;
      const step = Math.floor(data.length / bars);
      const barWidth = width / bars;
      ctx.fillStyle = '#2563eb';
      for (let i = 0; i < bars; i++) {
        const v = data[i * step] / 255;
        const barHeight = Math.max(4, v * height);
        ctx.beginPath();
        ctx.roundRect(i * barWidth + 2, (height - barHeight) / 2, barWidth - 4, barHeight, 3);
        ctx.fill();
      }
      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);
  }

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(1000); // gather data every second so a crash loses at most 1s
      recorderRef.current = recorder;

      setSeconds(0);
      timerRef.current = setInterval(() => {
        if (recorderRef.current?.state === 'recording') setSeconds((s) => s + 1);
      }, 1000);

      setState('recording');
      requestAnimationFrame(drawWaveform);
    } catch (err) {
      toast(
        'error',
        'Microphone access failed — check System Settings → Privacy & Security → Microphone'
      );
      console.error(err);
    }
  }

  function pause() {
    recorderRef.current?.pause();
    setState('paused');
  }

  function resume() {
    recorderRef.current?.resume();
    setState('recording');
  }

  async function stopAndSave() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    setState('saving');

    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.stop();
    await stopped;

    const mimeType = recorder.mimeType || 'audio/webm';
    const blob = new Blob(chunksRef.current, { type: mimeType });
    cleanup();

    try {
      const buffer = await blob.arrayBuffer();
      await window.api.addRecordedAudio(meetingId, buffer, mimeType, seconds);
      toast('success', 'Recording saved to the meeting folder');
      onDone();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to save recording');
      setState('paused');
    }
  }

  return (
    <div className="flex h-full flex-col bg-slate-900 text-white">
      <div className="titlebar-drag h-12 shrink-0" />
      <div className="flex flex-1 flex-col items-center justify-center px-8 pb-12">
        <p className="mb-1 text-sm text-slate-400">Recording to</p>
        <h1 className="mb-10 max-w-lg text-center text-xl font-semibold">{meetingTitle}</h1>

        {state === 'consent' ? (
          <div className="max-w-md text-center">
            <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-5 py-4 text-sm text-amber-200">
              Please make sure all meeting participants know the meeting is being recorded.
            </div>
            <div className="flex justify-center gap-3">
              <button
                onClick={onDone}
                className="rounded-lg border border-slate-600 px-5 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={start}
                className="rounded-lg bg-red-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
              >
                ● Start recording
              </button>
            </div>
          </div>
        ) : (
          <>
            <canvas ref={canvasRef} width={560} height={96} className="mb-8 w-full max-w-xl" />
            <p className="mb-8 font-mono text-5xl font-bold tabular-nums">
              {formatTimer(seconds)}
            </p>
            <div className="flex items-center gap-4">
              {state === 'recording' ? (
                <button
                  onClick={pause}
                  className="rounded-lg border border-slate-600 px-6 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800"
                >
                  ❚❚ Pause
                </button>
              ) : state === 'paused' ? (
                <button
                  onClick={resume}
                  className="rounded-lg border border-slate-600 px-6 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800"
                >
                  ▶ Resume
                </button>
              ) : null}
              <button
                onClick={stopAndSave}
                disabled={state === 'saving'}
                className="rounded-lg bg-blue-600 px-8 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {state === 'saving' ? 'Saving…' : '■ Stop & save'}
              </button>
            </div>
            {state === 'paused' && (
              <p className="mt-6 text-sm text-slate-400">Recording paused</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
