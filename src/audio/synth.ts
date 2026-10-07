/**
 * Tiny Web Audio synthesis toolkit: enveloped oscillators and filtered noise bursts, each a
 * short-lived node chain that disconnects itself when done. Everything the game sounds like is
 * built from these two calls (no audio files).
 */

/** Deterministic white-noise buffer (2 s, mono) shared by every noise voice. */
export function createNoiseBuffer(ctx: BaseAudioContext, seconds = 2): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let x = 0x2545f491;
  for (let i = 0; i < length; i++) {
    // xorshift32: same noise on every run, no Math.random.
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    data[i] = ((x >>> 0) / 4294967296) * 2 - 1;
  }
  return buffer;
}

const SILENT = 0.0001;

/** Attack / exponential-decay envelope on a fresh gain node. */
function envelope(
  ctx: BaseAudioContext,
  t: number,
  peak: number,
  attack: number,
  dur: number,
): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(SILENT, t);
  g.gain.linearRampToValueAtTime(Math.max(SILENT, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(SILENT, t + Math.max(attack + 0.01, dur));
  return g;
}

export interface ToneOptions {
  readonly type: OscillatorType;
  readonly freq: number;
  /** Exponential glide target reached at the end (Hz). */
  readonly freqEnd?: number;
  readonly t: number;
  readonly dur: number;
  readonly gain: number;
  readonly attack?: number;
  readonly detune?: number;
  /** Low-pass cutoff (Hz), none if omitted. */
  readonly lowpass?: number;
  /** Vibrato depth in Hz at 6 Hz, none if omitted. */
  readonly vibrato?: number;
}

/** Plays an enveloped oscillator into `dest`. */
export function tone(ctx: BaseAudioContext, dest: AudioNode, o: ToneOptions): void {
  const osc = ctx.createOscillator();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.freq, o.t);
  if (o.freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), o.t + o.dur);
  }
  if (o.detune) osc.detune.setValueAtTime(o.detune, o.t);
  const env = envelope(ctx, o.t, o.gain, o.attack ?? 0.005, o.dur);
  const nodes: AudioNode[] = [env];
  let head: AudioNode = osc;
  if (o.lowpass !== undefined) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(o.lowpass, o.t);
    head.connect(f);
    head = f;
    nodes.push(f);
  }
  if (o.vibrato) {
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(6, o.t);
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(o.vibrato, o.t);
    lfo.connect(depth);
    depth.connect(osc.frequency);
    nodes.push(depth, lfo);
    lfo.start(o.t);
    lfo.stop(o.t + o.dur + 0.05);
  }
  head.connect(env);
  env.connect(dest);
  osc.onended = () => {
    osc.disconnect();
    for (const n of nodes) n.disconnect();
  };
  osc.start(o.t);
  osc.stop(o.t + o.dur + 0.05);
}

export interface NoiseOptions {
  readonly t: number;
  readonly dur: number;
  readonly gain: number;
  readonly attack?: number;
  readonly filter: BiquadFilterType;
  readonly freq: number;
  /** Exponential filter sweep target (Hz). */
  readonly freqEnd?: number;
  readonly q?: number;
}

/** Plays a filtered noise burst into `dest`. */
export function noise(
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  dest: AudioNode,
  o: NoiseOptions,
): void {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const f = ctx.createBiquadFilter();
  f.type = o.filter;
  f.frequency.setValueAtTime(o.freq, o.t);
  if (o.freqEnd !== undefined) {
    f.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), o.t + o.dur);
  }
  if (o.q !== undefined) f.Q.setValueAtTime(o.q, o.t);
  const env = envelope(ctx, o.t, o.gain, o.attack ?? 0.003, o.dur);
  src.connect(f);
  f.connect(env);
  env.connect(dest);
  src.onended = () => {
    src.disconnect();
    f.disconnect();
    env.disconnect();
  };
  // Random-looking but fixed start offsets keep repeated bursts from sounding identical.
  const offset = (o.t * 7.31) % Math.max(0.01, buffer.duration - o.dur - 0.1);
  src.start(o.t, Math.max(0, offset));
  src.stop(o.t + o.dur + 0.05);
}
