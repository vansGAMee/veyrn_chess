/**
 * VEYRN Sound Engine — Synthesized tactile audio
 * 
 * Short dry transients via Web Audio API.
 * No audio files. Pure synthesis.
 * Created/resumed only after user gesture.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  
  return audioCtx;
}

// Stereo pan based on destination file (a=left, h=right)
function panFromFile(file: string): number {
  const idx = file.charCodeAt(0) - 97; // a=0, h=7
  return (idx - 3.5) / 3.5 * 0.15; // -0.15 to +0.15
}

interface SoundOptions {
  file?: string; // for stereo positioning
  gain?: number;
}

/**
 * Stone/wood click: bandpass-filtered noise burst
 */
function playClick(
  ctx: AudioContext,
  frequency: number,
  duration: number,
  options: SoundOptions = {}
) {
  const { file, gain: gainVal = 0.08 } = options;
  const now = ctx.currentTime;

  // Noise source
  const bufferSize = Math.ceil(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  // Bandpass filter
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = frequency;
  filter.Q.value = 2;

  // Gain envelope — fast attack, fast decay
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(gainVal, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  // Stereo panner
  const panner = ctx.createStereoPanner();
  panner.pan.value = file ? panFromFile(file) : 0;

  // Connect: noise → filter → gain → panner → destination
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(panner);
  panner.connect(ctx.destination);

  noise.start(now);
  noise.stop(now + duration);
}

/**
 * Subtle tonal body component for richer sounds
 */
function playTone(
  ctx: AudioContext,
  frequency: number,
  duration: number,
  options: SoundOptions = {}
) {
  const { file, gain: gainVal = 0.03 } = options;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = frequency;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(gainVal, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  const panner = ctx.createStereoPanner();
  panner.pan.value = file ? panFromFile(file) : 0;

  osc.connect(gain);
  gain.connect(panner);
  panner.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + duration);
}

// ─── Public Sound API ───────────────────────────────

export function playMoveSound(toSquare?: string) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const file = toSquare?.[0];
  playClick(ctx, 2200, 0.035, { file, gain: 0.07 });
  playTone(ctx, 440, 0.025, { file, gain: 0.02 });
}

export function playCaptureSound(toSquare?: string) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const file = toSquare?.[0];
  // Denser, lower transient for captures
  playClick(ctx, 1200, 0.045, { file, gain: 0.10 });
  playTone(ctx, 280, 0.035, { file, gain: 0.03 });
}

export function playCastleSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  // Double click — two pieces moving
  playClick(ctx, 2200, 0.030, { gain: 0.06 });
  setTimeout(() => {
    if (!ctx) return;
    playClick(ctx, 2000, 0.030, { gain: 0.05 });
  }, 60);
}

export function playCheckSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  playClick(ctx, 3000, 0.040, { gain: 0.09 });
  playTone(ctx, 660, 0.050, { gain: 0.04 });
}

export function playGameStartSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  playClick(ctx, 1800, 0.025, { gain: 0.05 });
  playTone(ctx, 523, 0.040, { gain: 0.025 });
}

export function playGameEndSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  playTone(ctx, 392, 0.120, { gain: 0.04 });
  playTone(ctx, 330, 0.150, { gain: 0.03 });
}

export function playPeerJoinedSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  playClick(ctx, 2500, 0.020, { gain: 0.04 });
  setTimeout(() => {
    const c = getAudioContext();
    if (!c) return;
    playTone(c, 587, 0.035, { gain: 0.025 });
  }, 40);
}

export function initAudioOnGesture() {
  getAudioContext();
}
