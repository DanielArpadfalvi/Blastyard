/**
 * Generative music (T3.2, PLAN §1.13): three tracks – menu, match and sudden death (+15 % tempo) –
 * composed bar by bar from a chord loop, rhythm templates and a seeded melody generator. The same
 * (track, bar, seed) always gives the same notes, so the music is varied but reproducible.
 *
 * Pure: produces note lists; `musicPlayer.ts` schedules them on Web Audio.
 */

export type MusicTrack = 'menu' | 'match' | 'suddenDeath';
export const MUSIC_TRACKS: readonly MusicTrack[] = ['menu', 'match', 'suddenDeath'];

export type Voice = 'pad' | 'bass' | 'lead' | 'bell' | 'kick' | 'snare' | 'hat';

export interface NoteEvent {
  /** Start within the bar, in beats (0 ≤ beat < BEATS_PER_BAR). */
  readonly beat: number;
  /** Length in beats. */
  readonly dur: number;
  /** MIDI note (ignored by the drums). */
  readonly midi: number;
  readonly voice: Voice;
  /** 0–1. */
  readonly vel: number;
}

export const BEATS_PER_BAR = 4;
export const MENU_BPM = 96;
export const MATCH_BPM = 124;
/** Sudden death plays the match groove 15 % faster (PLAN §1.13). */
export const SUDDEN_DEATH_TEMPO = 1.15;

interface TrackDef {
  readonly bpm: number;
  /** MIDI root of the key. */
  readonly root: number;
  /** Scale as semitone offsets from the root. */
  readonly scale: readonly number[];
  /** Chord per bar: scale degree (0-based) of the chord root, looped. */
  readonly progression: readonly number[];
  /** Chance that a melody slot stays silent. */
  readonly rest: number;
  /** Melody slot length in beats. */
  readonly slot: number;
  readonly melodyVoice: Voice;
}

const TRACKS: Readonly<Record<MusicTrack, TrackDef>> = {
  // Relaxed backyard afternoon: F major, bell arpeggios over soft pads.
  menu: {
    bpm: MENU_BPM,
    root: 53,
    scale: [0, 2, 4, 5, 7, 9, 11],
    progression: [0, 5, 3, 4],
    rest: 0.4,
    slot: 0.5,
    melodyVoice: 'bell',
  },
  // Bouncy playground chase: A minor (dorian sixth), driving bass, plucky lead.
  match: {
    bpm: MATCH_BPM,
    root: 45,
    scale: [0, 2, 3, 5, 7, 9, 10],
    progression: [0, 5, 6, 4],
    rest: 0.35,
    slot: 0.5,
    melodyVoice: 'lead',
  },
  // Walls closing in: harmonic minor, same key, faster and busier.
  suddenDeath: {
    bpm: MATCH_BPM * SUDDEN_DEATH_TEMPO,
    root: 45,
    scale: [0, 2, 3, 5, 7, 8, 11],
    progression: [0, 5, 3, 4],
    rest: 0.2,
    slot: 0.25,
    melodyVoice: 'lead',
  },
};

export function trackBpm(track: MusicTrack): number {
  return TRACKS[track].bpm;
}

/** Seconds per bar. */
export function barSeconds(track: MusicTrack): number {
  return (BEATS_PER_BAR * 60) / TRACKS[track].bpm;
}

/** Small seeded generator (mulberry32) – music only, never the simulation. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TRACK_SALT: Readonly<Record<MusicTrack, number>> = {
  menu: 0x1f2e3d4c,
  match: 0x5b6a7988,
  suddenDeath: 0x13579bdf,
};

/** MIDI note of scale degree `degree` (may exceed the octave) above the track root. */
function degreeNote(def: TrackDef, degree: number): number {
  const n = def.scale.length;
  const octave = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return def.root + 12 * octave + (def.scale[idx] as number);
}

/** Triad (root, third, fifth) on scale degree `degree`. */
function triad(def: TrackDef, degree: number): number[] {
  return [degreeNote(def, degree), degreeNote(def, degree + 2), degreeNote(def, degree + 4)];
}

function drums(track: MusicTrack, out: NoteEvent[]): void {
  const hit = (beat: number, voice: Voice, vel: number): void => {
    out.push({ beat, dur: 0.25, midi: 0, voice, vel });
  };
  if (track === 'menu') {
    for (const b of [0.5, 1.5, 2.5, 3.5]) hit(b, 'hat', 0.25);
    hit(0, 'kick', 0.35);
    hit(2, 'kick', 0.3);
    return;
  }
  if (track === 'match') {
    for (const b of [0, 1.5, 2]) hit(b, 'kick', 0.8);
    for (const b of [1, 3]) hit(b, 'snare', 0.6);
    for (let b = 0; b < 4; b += 0.5) hit(b, 'hat', b % 1 === 0 ? 0.3 : 0.45);
    return;
  }
  for (const b of [0, 1, 2, 3]) hit(b, 'kick', 0.85);
  for (const b of [1, 3]) hit(b, 'snare', 0.65);
  for (let b = 0; b < 4; b += 0.25) hit(b, 'hat', b % 0.5 === 0 ? 0.3 : 0.2);
}

function bass(
  track: MusicTrack,
  def: TrackDef,
  degree: number,
  r: () => number,
  out: NoteEvent[],
): void {
  const root = degreeNote(def, degree) - 12;
  const fifth = degreeNote(def, degree + 4) - 12;
  if (track === 'menu') {
    out.push({ beat: 0, dur: 1.75, midi: root, voice: 'bass', vel: 0.5 });
    out.push({ beat: 2, dur: 1.75, midi: r() < 0.5 ? fifth : root, voice: 'bass', vel: 0.45 });
    return;
  }
  // Eighth-note drive: root with fifth / octave pick-ups chosen per bar (0 = rest).
  const pattern =
    track === 'suddenDeath'
      ? [root, root, root + 12, root, root, root, fifth, root]
      : r() < 0.5
        ? [root, 0, root, root + 12, 0, root, fifth, 0]
        : [root, 0, fifth, root, 0, root, root + 12, fifth];
  pattern.forEach((midi, i) => {
    if (midi > 0) out.push({ beat: i * 0.5, dur: 0.42, midi, voice: 'bass', vel: 0.7 });
  });
}

/**
 * Melody: walks the chord tones and their scale neighbours with seeded rests. The rhythm repeats
 * every two bars of a 4-bar phrase while the pitches move on, which keeps it hummable.
 */
function melody(
  def: TrackDef,
  degree: number,
  rhythmRng: () => number,
  pitchRng: () => number,
  out: NoteEvent[],
): void {
  let step = Math.floor(pitchRng() * 3) * 2;
  for (let i = 0; i * def.slot < BEATS_PER_BAR; i++) {
    const beat = i * def.slot;
    const rest = rhythmRng() < def.rest;
    const long = rhythmRng() < 0.3;
    const move = pitchRng();
    if (rest) continue;
    // Mostly chord tones (even offsets), sometimes a passing note.
    if (move < 0.35) step += 1;
    else if (move < 0.6) step -= 1;
    else if (move < 0.8) step += 2;
    else step -= 2;
    if (step < 0) step = 1;
    if (step > 9) step = 7;
    const strong = beat % 1 === 0;
    const offset = strong && step % 2 === 1 ? step - 1 : step;
    out.push({
      beat,
      dur: def.slot * (long ? 1.6 : 0.9),
      midi: degreeNote(def, degree + offset) + 12,
      voice: def.melodyVoice,
      vel: strong ? 0.6 : 0.45,
    });
  }
}

/** All notes of bar `bar` of `track` for a music seed. Deterministic. */
export function composeBar(track: MusicTrack, bar: number, seed: number): NoteEvent[] {
  const def = TRACKS[track];
  const b = Math.max(0, Math.floor(bar));
  const degree = def.progression[b % def.progression.length] as number;
  const salt = (seed ^ TRACK_SALT[track]) >>> 0;
  const phrase = Math.floor(b / 4);
  const rhythmRng = rng(salt ^ Math.imul(phrase * 2 + (b % 2) + 1, 0x9e3779b1));
  const pitchRng = rng(salt ^ Math.imul(b + 1, 0x85ebca6b));
  const out: NoteEvent[] = triad(def, degree).map((midi) => ({
    beat: 0,
    dur: BEATS_PER_BAR,
    midi,
    voice: 'pad' as const,
    vel: track === 'menu' ? 0.35 : 0.22,
  }));
  bass(track, def, degree, pitchRng, out);
  // Every 8th bar of the match tracks takes a breath: no melody.
  if (track === 'menu' || b % 8 !== 7) melody(def, degree, rhythmRng, pitchRng, out);
  drums(track, out);
  return out;
}

/** MIDI note → frequency in Hz. */
export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}
