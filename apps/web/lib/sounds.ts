'use client';
// ─────────────────────────────────────────────────────────────────
// CIRCUIT 23 — Game Sound Effects  (Web Audio API 合成・ファイル不要)
// ─────────────────────────────────────────────────────────────────
let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx || ctx.state === 'closed') {
    ctx = new AudioContext();
  }
  // Safari: suspended state を resume
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** 単音を鳴らす (delay: 秒) */
function ramp(
  freq: number,
  dur: number,
  type: OscillatorType = 'sine',
  vol = 0.22,
  delay = 0,
) {
  try {
    const c = getCtx();
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(c.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.001, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  } catch {
    // AudioContext 未対応 or permission denied
  }
}

export type SoundName =
  | 'deal'
  | 'chips'
  | 'fold'
  | 'check'
  | 'bet'
  | 'raise'
  | 'win'
  | 'your_turn';

export function playSound(name: SoundName): void {
  if (typeof window === 'undefined') return;
  switch (name) {
    case 'deal':
      ramp(950, 0.07, 'square', 0.12, 0);
      ramp(750, 0.07, 'square', 0.10, 0.07);
      break;
    case 'chips':
      ramp(1200, 0.06, 'square', 0.14, 0);
      ramp(1000, 0.06, 'square', 0.11, 0.065);
      ramp(820,  0.08, 'square', 0.09, 0.13);
      break;
    case 'fold':
      ramp(360, 0.14, 'sine', 0.18, 0);
      ramp(220, 0.22, 'sine', 0.10, 0.1);
      break;
    case 'check':
      ramp(660, 0.10, 'sine', 0.20, 0);
      break;
    case 'bet':
      ramp(760, 0.07, 'square', 0.17, 0);
      ramp(960, 0.08, 'square', 0.17, 0.07);
      break;
    case 'raise':
      ramp(760,  0.07, 'square', 0.17, 0);
      ramp(960,  0.07, 'square', 0.17, 0.07);
      ramp(1160, 0.10, 'square', 0.17, 0.14);
      break;
    case 'win':
      ramp(523,  0.22, 'sine', 0.20, 0);
      ramp(659,  0.22, 'sine', 0.20, 0.13);
      ramp(784,  0.22, 'sine', 0.20, 0.26);
      ramp(1047, 0.32, 'sine', 0.24, 0.40);
      break;
    case 'your_turn':
      ramp(880,  0.13, 'sine', 0.26, 0);
      ramp(1100, 0.18, 'sine', 0.22, 0.11);
      break;
  }
}
