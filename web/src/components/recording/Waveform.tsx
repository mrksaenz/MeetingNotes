'use client';

import { useRef, useEffect } from 'react';

interface WaveformProps {
  data: number[];
  isRecording: boolean;
  color?: string;
}

export default function Waveform({ data, isRecording, color = '#3b82f6' }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high-DPI displays
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const centerY = height / 2;
    const barWidth = 3;
    const barGap = 2;
    const totalBarWidth = barWidth + barGap;
    const maxBars = Math.floor(width / totalBarWidth);

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw center line
    ctx.strokeStyle = isRecording ? `${color}20` : '#e2e8f020';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    // Draw waveform bars
    const displayData = data.slice(-maxBars);

    displayData.forEach((amplitude, i) => {
      const x = (i + (maxBars - displayData.length)) * totalBarWidth;
      const barHeight = Math.max(2, amplitude * (height * 0.8));

      // Gradient effect: more recent bars are more opaque
      const progress = i / displayData.length;
      const alpha = 0.3 + progress * 0.7;

      ctx.fillStyle = isRecording
        ? `${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`
        : `#64748b${Math.round(alpha * 128).toString(16).padStart(2, '0')}`;

      ctx.beginPath();
      ctx.roundRect(
        x,
        centerY - barHeight / 2,
        barWidth,
        barHeight,
        1.5
      );
      ctx.fill();
    });
  }, [data, isRecording, color]);

  return (
    <canvas
      ref={canvasRef}
      className="h-24 w-full md:h-32"
      style={{ width: '100%' }}
    />
  );
}
