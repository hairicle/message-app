'use client';

import { useEffect, useState } from 'react';

/** Decoded amplitude per bar, normalised to 0..1. */
export type Waveform = number[];

// Decoding is expensive and the same voice note is re-rendered on every thread update, so results
// are shared process-wide. Blob URLs are already cached per file id, which makes them a stable key.
const cache = new Map<string, Waveform>();
const inFlight = new Map<string, Promise<Waveform>>();

/**
 * A stand-in used before the real peaks arrive and if decoding fails (unsupported codec, a browser
 * without OfflineAudioContext). Derived from the key so a given note always looks the same rather
 * than reshuffling on re-render.
 */
export function placeholderWaveform(key: string, bars: number): Waveform {
  let seed = 0;
  for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) >>> 0;
  return Array.from({ length: bars }, (_, i) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    // Bias towards the middle of the range so it reads as speech rather than noise.
    return 0.25 + ((seed >>> 8) % 1000) / 1000 * 0.55 * (0.7 + 0.3 * Math.sin((i / bars) * Math.PI));
  });
}

async function decode(url: string, bars: number): Promise<Waveform> {
  const res = await fetch(url);
  const bytes = await res.arrayBuffer();

  // OfflineAudioContext decodes without opening an output device, so this never trips the
  // browser's "AudioContext was not allowed to start" autoplay gate.
  const Ctx: typeof OfflineAudioContext | undefined =
    window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Ctx) throw new Error('no OfflineAudioContext');

  const buffer = await new Ctx(1, 1, 22050).decodeAudioData(bytes);
  const samples = buffer.getChannelData(0);
  const per = Math.floor(samples.length / bars) || 1;

  const peaks: number[] = [];
  for (let i = 0; i < bars; i++) {
    let sum = 0;
    const start = i * per;
    const end = Math.min(start + per, samples.length);
    for (let j = start; j < end; j++) sum += samples[j] * samples[j];
    peaks.push(Math.sqrt(sum / Math.max(1, end - start))); // RMS reads better than raw peak
  }

  // Normalise against a high percentile rather than the outright maximum: a single clipped spike
  // would otherwise crush every other bar to nothing.
  const sorted = [...peaks].sort((a, b) => a - b);
  const reference = Math.max(sorted[Math.floor(sorted.length * 0.95)] ?? 0, 1e-4);

  // Speech is mostly low-amplitude, so a linear scale leaves the strip looking flat. The curve
  // lifts quiet detail into view the way an audio editor's display does.
  return peaks.map((p) => Math.min(1, (p / reference) ** 0.55));
}

/**
 * Real amplitude peaks for an audio URL, for drawing a waveform. Returns a deterministic
 * placeholder until decoding finishes, so the player never renders an empty strip.
 */
export function useWaveform(url: string | null, bars = 34): { peaks: Waveform; ready: boolean } {
  const usable = url && url !== 'error' ? url : null;
  const [peaks, setPeaks] = useState<Waveform | null>(() => (usable ? cache.get(usable) ?? null : null));

  useEffect(() => {
    if (!usable) return;

    const cached = cache.get(usable);
    if (cached) {
      setPeaks(cached);
      return;
    }

    let cancelled = false;
    let pending = inFlight.get(usable);
    if (!pending) {
      pending = decode(usable, bars)
        .then((w) => {
          cache.set(usable, w);
          return w;
        })
        .finally(() => inFlight.delete(usable));
      inFlight.set(usable, pending);
    }

    pending.then((w) => !cancelled && setPeaks(w)).catch(() => {
      // Undecodable: keep the placeholder rather than collapsing the player.
      if (!cancelled) setPeaks(null);
    });

    return () => {
      cancelled = true;
    };
  }, [usable, bars]);

  return {
    peaks: peaks ?? placeholderWaveform(usable ?? 'empty', bars),
    ready: peaks !== null,
  };
}
