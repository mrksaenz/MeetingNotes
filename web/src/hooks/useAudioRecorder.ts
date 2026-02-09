'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

export type RecordingState = 'idle' | 'recording' | 'paused' | 'stopped';

interface UseAudioRecorderReturn {
  state: RecordingState;
  duration: number;
  waveformData: number[];
  audioBlob: Blob | null;
  startRecording: () => Promise<void>;
  pauseRecording: () => void;
  resumeRecording: () => void;
  stopRecording: () => void;
  resetRecording: () => void;
  error: string | null;
}

export function useAudioRecorder(): UseAudioRecorderReturn {
  const [state, setState] = useState<RecordingState>('idle');
  const [duration, setDuration] = useState(0);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedDurationRef = useRef<number>(0);

  const cleanup = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
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

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setAudioBlob(null);
      audioChunksRef.current = [];
      setWaveformData([]);

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

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 128000,
      });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        setAudioBlob(blob);
      };

      mediaRecorder.start(1000); // Collect data every second
      startTimeRef.current = Date.now();
      pausedDurationRef.current = 0;
      setState('recording');
      startTimer();
      updateWaveform();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to access microphone';
      setError(message);
      cleanup();
    }
  }, [cleanup, startTimer, updateWaveform]);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && state === 'recording') {
      mediaRecorderRef.current.pause();
      pausedDurationRef.current += Date.now() - startTimeRef.current;
      if (timerRef.current) clearInterval(timerRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
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
    }
  }, [state, startTimer, updateWaveform]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && (state === 'recording' || state === 'paused')) {
      if (state === 'recording') {
        pausedDurationRef.current += Date.now() - startTimeRef.current;
      }
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
    audioChunksRef.current = [];
    pausedDurationRef.current = 0;
  }, [cleanup]);

  return {
    state,
    duration,
    waveformData,
    audioBlob,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    resetRecording,
    error,
  };
}
