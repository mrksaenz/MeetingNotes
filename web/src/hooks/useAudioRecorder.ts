'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

export type RecordingState = 'idle' | 'recording' | 'paused' | 'stopped';

const DEFAULT_SEGMENT_DURATION_MS = 5 * 60 * 1000; // 5 minutes

interface UseAudioRecorderOptions {
  /** Segment duration in milliseconds. Default: 5 minutes. Set to 0 to disable segmentation. */
  segmentDurationMs?: number;
  /** Called when a completed segment is ready (only fires if segmentation is enabled). */
  onSegmentReady?: (blob: Blob, segmentNumber: number) => void;
}

interface UseAudioRecorderReturn {
  state: RecordingState;
  duration: number;
  waveformData: number[];
  audioBlob: Blob | null;
  currentSegmentNumber: number;
  segmentsCompleted: number;
  startRecording: () => Promise<void>;
  pauseRecording: () => void;
  resumeRecording: () => void;
  stopRecording: () => void;
  resetRecording: () => void;
  error: string | null;
}

export function useAudioRecorder(options?: UseAudioRecorderOptions): UseAudioRecorderReturn {
  const segmentDurationMs = options?.segmentDurationMs ?? DEFAULT_SEGMENT_DURATION_MS;
  const onSegmentReadyRef = useRef(options?.onSegmentReady);
  onSegmentReadyRef.current = options?.onSegmentReady;

  const [state, setState] = useState<RecordingState>('idle');
  const [duration, setDuration] = useState(0);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentSegmentNumber, setCurrentSegmentNumber] = useState(0);
  const [segmentsCompleted, setSegmentsCompleted] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedDurationRef = useRef<number>(0);

  // Segmentation refs
  const segmentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const segmentNumberRef = useRef<number>(0);
  const isCyclingRef = useRef<boolean>(false);
  const segmentStartTimeRef = useRef<number>(0);
  const segmentElapsedOnPauseRef = useRef<number>(0);
  const mimeTypeRef = useRef<string>('audio/webm;codecs=opus');

  const cleanup = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (segmentTimerRef.current) {
      clearTimeout(segmentTimerRef.current);
      segmentTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    mediaRecorderRef.current = null;
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const updateWaveform = useCallback(() => {
    if (!analyserRef.current) return;

    const analyser = analyserRef.current;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(dataArray);

    // Calculate RMS amplitude normalized to 0-1
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const normalized = (dataArray[i] - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / dataArray.length);
    const amplitude = Math.min(1, rms * 3); // Boost for visibility

    setWaveformData((prev) => {
      const next = [...prev, amplitude];
      // Keep last 200 data points
      if (next.length > 200) return next.slice(-200);
      return next;
    });

    animationFrameRef.current = requestAnimationFrame(updateWaveform);
  }, []);

  const startTimer = useCallback(() => {
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      setDuration(Math.floor((pausedDurationRef.current + elapsed) / 1000));
    }, 200);
  }, []);

  // Create a new MediaRecorder on the existing stream
  const createMediaRecorder = useCallback((stream: MediaStream) => {
    const mimeType = mimeTypeRef.current;
    const mediaRecorder = new MediaRecorder(stream, {
      mimeType,
      audioBitsPerSecond: 48000,
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(audioChunksRef.current, { type: mimeType });

      if (isCyclingRef.current) {
        // This is a segment cycle — emit segment and start new recorder
        isCyclingRef.current = false;
        const completedSegmentNumber = segmentNumberRef.current;
        segmentNumberRef.current += 1;
        setCurrentSegmentNumber(segmentNumberRef.current);
        setSegmentsCompleted((prev) => prev + 1);

        // Clear chunks for next segment
        audioChunksRef.current = [];

        // Emit segment via callback
        onSegmentReadyRef.current?.(blob, completedSegmentNumber);

        // Start new MediaRecorder on the same stream
        if (streamRef.current && streamRef.current.active) {
          const newRecorder = createMediaRecorder(streamRef.current);
          mediaRecorderRef.current = newRecorder;
          newRecorder.start(1000);

          // Schedule next segment cycle
          segmentStartTimeRef.current = Date.now();
          segmentElapsedOnPauseRef.current = 0;
          scheduleSegmentCycle(segmentDurationMs);
        }
      } else {
        // This is a final stop — set the audioBlob for save flow
        setAudioBlob(blob);
      }
    };

    return mediaRecorder;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentDurationMs]);

  // Schedule the next segment cycle
  const scheduleSegmentCycle = useCallback((remainingMs: number) => {
    if (segmentDurationMs <= 0) return;
    if (segmentTimerRef.current) {
      clearTimeout(segmentTimerRef.current);
    }
    segmentTimerRef.current = setTimeout(() => {
      segmentTimerRef.current = null;
      // Cycle: stop current recorder (triggers onstop with isCycling=true)
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        isCyclingRef.current = true;
        mediaRecorderRef.current.stop();
      }
    }, remainingMs);
  }, [segmentDurationMs]);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setAudioBlob(null);
      audioChunksRef.current = [];
      setWaveformData([]);
      segmentNumberRef.current = 0;
      setCurrentSegmentNumber(0);
      setSegmentsCompleted(0);
      isCyclingRef.current = false;
      segmentElapsedOnPauseRef.current = 0;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        },
      });
      streamRef.current = stream;

      // Set up audio analysis for waveform
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Determine best mime type
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';
      mimeTypeRef.current = mimeType;

      const mediaRecorder = createMediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.start(1000); // Collect data every second
      startTimeRef.current = Date.now();
      pausedDurationRef.current = 0;
      setState('recording');
      startTimer();
      updateWaveform();

      // Start segment timer
      if (segmentDurationMs > 0) {
        segmentStartTimeRef.current = Date.now();
        scheduleSegmentCycle(segmentDurationMs);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to access microphone';
      setError(message);
      cleanup();
    }
  }, [cleanup, startTimer, updateWaveform, createMediaRecorder, scheduleSegmentCycle, segmentDurationMs]);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && state === 'recording') {
      mediaRecorderRef.current.pause();
      pausedDurationRef.current += Date.now() - startTimeRef.current;
      if (timerRef.current) clearInterval(timerRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);

      // Pause segment timer: save how much of the current segment period has elapsed
      if (segmentTimerRef.current) {
        clearTimeout(segmentTimerRef.current);
        segmentTimerRef.current = null;
        segmentElapsedOnPauseRef.current += Date.now() - segmentStartTimeRef.current;
      }

      setState('paused');
    }
  }, [state]);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && state === 'paused') {
      mediaRecorderRef.current.resume();
      startTimeRef.current = Date.now();
      setState('recording');
      startTimer();
      updateWaveform();

      // Resume segment timer with remaining time
      if (segmentDurationMs > 0) {
        const remaining = segmentDurationMs - segmentElapsedOnPauseRef.current;
        segmentStartTimeRef.current = Date.now();
        if (remaining > 0) {
          scheduleSegmentCycle(remaining);
        } else {
          // Segment should have fired during pause — cycle now
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            isCyclingRef.current = true;
            mediaRecorderRef.current.stop();
          }
        }
      }
    }
  }, [state, startTimer, updateWaveform, segmentDurationMs, scheduleSegmentCycle]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && (state === 'recording' || state === 'paused')) {
      if (state === 'recording') {
        pausedDurationRef.current += Date.now() - startTimeRef.current;
      }
      // Cancel segment timer — this is a final stop
      if (segmentTimerRef.current) {
        clearTimeout(segmentTimerRef.current);
        segmentTimerRef.current = null;
      }
      isCyclingRef.current = false;
      mediaRecorderRef.current.stop();
      if (timerRef.current) clearInterval(timerRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      // Stop microphone
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      setState('stopped');
    }
  }, [state]);

  const resetRecording = useCallback(() => {
    cleanup();
    setState('idle');
    setDuration(0);
    setWaveformData([]);
    setAudioBlob(null);
    setError(null);
    setCurrentSegmentNumber(0);
    setSegmentsCompleted(0);
    audioChunksRef.current = [];
    pausedDurationRef.current = 0;
    segmentNumberRef.current = 0;
    isCyclingRef.current = false;
    segmentElapsedOnPauseRef.current = 0;
  }, [cleanup]);

  return {
    state,
    duration,
    waveformData,
    audioBlob,
    currentSegmentNumber,
    segmentsCompleted,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    resetRecording,
    error,
  };
}
