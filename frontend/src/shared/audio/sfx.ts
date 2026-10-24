"use client";

/** Tiny synthesized sound kit (Web Audio). No external audio files. */
let ctx: AudioContext | null = null;
let muted = false;

function ac() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function setMuted(v: boolean) {
  muted = v;
}
export function isMuted() {
  return muted;
}

/** Longest noise burst we play, plus headroom for a random start offset. */
const NOISE_SECONDS = 3;
let noiseBuf: AudioBuffer | null = null;

/** One shared white-noise buffer; each sound plays a random slice of it. */
function noiseBuffer(c: AudioContext) {
  if (noiseBuf?.sampleRate !== c.sampleRate) {
    noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * NOISE_SECONDS), c.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function noise(
  c: AudioContext,
  opts: { dur: number; freq: number; q?: number; gain: number; type?: BiquadFilterType },
) {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const f = c.createBiquadFilter();
  f.type = opts.type ?? "lowpass";
  f.frequency.value = opts.freq;
  f.Q.value = opts.q ?? 0.7;
  const g = c.createGain();
  const t = c.currentTime;
  g.gain.setValueAtTime(opts.gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + opts.dur);
  src.connect(f).connect(g).connect(c.destination);
  src.start(t, Math.random() * (NOISE_SECONDS - opts.dur), opts.dur);
}

function tone(
  c: AudioContext,
  opts: { freq: number; to?: number; dur: number; gain: number; type?: OscillatorType; delay?: number },
) {
  const o = c.createOscillator();
  o.type = opts.type ?? "square";
  const g = c.createGain();
  const t = c.currentTime + (opts.delay ?? 0);
  o.frequency.setValueAtTime(opts.freq, t);
  if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + opts.dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + opts.dur + 0.05);
}

/** Wrap a sound so it is skipped when audio is unavailable or muted. */
function play(fn: (c: AudioContext) => void) {
  return () => {
    const c = ac();
    if (c && !muted) fn(c);
  };
}

export const sfx = {
  /** "DOR!" — crack + low thump. */
  shot: play((c) => {
    noise(c, { dur: 0.18, freq: 3200, gain: 0.5, type: "highpass" });
    noise(c, { dur: 0.35, freq: 600, gain: 0.6 });
    tone(c, { freq: 140, to: 40, dur: 0.25, gain: 0.5, type: "sine" });
  }),
  shotgun: play((c) => {
    noise(c, { dur: 0.45, freq: 900, gain: 0.8 });
    tone(c, { freq: 110, to: 30, dur: 0.35, gain: 0.6, type: "sine" });
  }),
  boom: play((c) => {
    noise(c, { dur: 1.1, freq: 400, gain: 0.9 });
    tone(c, { freq: 90, to: 25, dur: 0.8, gain: 0.7, type: "sine" });
  }),
  clink: play((c) => {
    tone(c, { freq: 1800, to: 900, dur: 0.25, gain: 0.25, type: "triangle" });
    tone(c, { freq: 2400, to: 1200, dur: 0.2, gain: 0.15, type: "triangle", delay: 0.05 });
  }),
  rumble: play((c) => {
    noise(c, { dur: 1.4, freq: 180, gain: 0.7 });
  }),
  tick: play((c) => {
    tone(c, { freq: 880, dur: 0.07, gain: 0.12 });
  }),
  click: play((c) => {
    tone(c, { freq: 520, to: 700, dur: 0.06, gain: 0.08 });
  }),
  lock: play((c) => {
    tone(c, { freq: 440, dur: 0.08, gain: 0.12 });
    tone(c, { freq: 660, dur: 0.12, gain: 0.12, delay: 0.08 });
  }),
  win: play((c) => {
    [523, 659, 784, 1046].forEach((f, i) => tone(c, { freq: f, dur: 0.22, gain: 0.15, delay: i * 0.12 }));
  }),
  lose: play((c) => {
    [392, 330, 262].forEach((f, i) => tone(c, { freq: f, dur: 0.3, gain: 0.14, delay: i * 0.18, type: "triangle" }));
  }),
};
