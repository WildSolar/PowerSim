/**
 * The ambient music: made as it plays, never quite repeating (sound.ts's music bus).
 *
 * A slow round of four chords in D — D, B minor, G, A, each voiced open and held for about a
 * quarter of a minute, fading into the next — played by a soft pad (two slightly detuned voices per
 * note, under a gently breathing low-pass filter), with a quiet root below. Over it, now and then,
 * a bell: a note of the D major pentatonic, mostly one of the chord's, placed somewhere in the
 * stereo field and echoing away; sometimes a short rising figure of three. Long stretches of
 * near-stillness are part of it.
 *
 * A scheduler looks a few seconds ahead and books what falls in that window, so the music keeps
 * time even when the page is busy. Turning it off lets what is sounding fade.
 */

import { sound, type AudioGraph } from "./sound";

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

// The chords: a pad voicing and a root, in MIDI notes.
const CHORDS: { pad: number[]; root: number; tones: number[] }[] = [
  { pad: [50, 57, 64, 66], root: 38, tones: [62, 66, 69, 74, 76, 78] }, // D(add9)
  { pad: [47, 54, 57, 62], root: 35, tones: [71, 74, 78, 81, 83] }, // Bm7
  { pad: [43, 50, 54, 59], root: 31, tones: [67, 71, 74, 79, 83] }, // Gmaj7
  { pad: [45, 52, 57, 59], root: 33, tones: [69, 71, 76, 81, 83] }, // Asus2
];
// The bells' scale: D major pentatonic, from D5 up.
const PENTATONIC = [74, 76, 78, 81, 83, 86, 88];

const LOOKAHEAD_S = 4;
const TICK_MS = 400;

class Music {
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextChordAt = 0;
  private chordIndex = 0;
  private nextBellAt = 0;
  private pad: { filter: BiquadFilterNode; out: GainNode } | null = null;
  private delay: { input: GainNode } | null = null;

  init(): void {
    sound.onMusicChange((on) => (on ? this.start() : this.stop()));
  }

  private start(): void {
    const graph = sound.ensure();
    if (!graph || this.timer) return;
    this.build(graph);
    const t = graph.ctx.currentTime + 0.2;
    this.nextChordAt = t;
    this.nextBellAt = t + 6;
    this.timer = setInterval(() => this.schedule(graph), TICK_MS);
    this.schedule(graph);
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** The pad's filter (breathing slowly) and the bells' echo, made once. */
  private build(graph: AudioGraph): void {
    if (this.pad) return;
    const { ctx } = graph;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    filter.Q.value = 0.4;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.035;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 350;
    lfo.connect(lfoDepth).connect(filter.frequency);
    lfo.start();
    const out = ctx.createGain();
    out.gain.value = 1;
    filter.connect(out);
    out.connect(graph.music);
    const send = ctx.createGain();
    send.gain.value = 0.6;
    out.connect(send).connect(graph.musicReverb);
    this.pad = { filter, out };

    // The bells' echo: a dotted delay feeding back into itself, darkened each time round.
    const input = ctx.createGain();
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.68;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.38;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2200;
    input.connect(delay).connect(tone).connect(feedback).connect(delay);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    tone.connect(wet).connect(graph.music);
    wet.connect(graph.musicReverb);
    this.delay = { input };
  }

  private schedule(graph: AudioGraph): void {
    const horizon = graph.ctx.currentTime + LOOKAHEAD_S;
    // A long pause (the tab was hidden): pick up from now rather than catch up.
    if (this.nextChordAt < graph.ctx.currentTime - 2) this.nextChordAt = graph.ctx.currentTime + 0.2;
    if (this.nextBellAt < graph.ctx.currentTime - 2) this.nextBellAt = graph.ctx.currentTime + 2;
    while (this.nextChordAt < horizon) {
      const length = 14 + Math.random() * 6;
      this.chord(graph, CHORDS[this.chordIndex], this.nextChordAt, length);
      this.chordIndex = (this.chordIndex + 1) % CHORDS.length;
      this.nextChordAt += length;
    }
    while (this.nextBellAt < horizon) {
      const current = CHORDS[(this.chordIndex + CHORDS.length - 1) % CHORDS.length];
      const r = Math.random();
      if (r < 0.15) {
        // A short rising figure.
        const startIdx = Math.floor(Math.random() * (PENTATONIC.length - 3));
        for (let i = 0; i < 3; i++) this.bell(graph, PENTATONIC[startIdx + i], this.nextBellAt + i * 0.34, 0.045);
      } else if (r < 0.8) {
        const pool = Math.random() < 0.7 ? current.tones : PENTATONIC;
        this.bell(graph, pool[Math.floor(Math.random() * pool.length)], this.nextBellAt, 0.05);
      }
      // ...and otherwise, a rest.
      this.nextBellAt += 2.2 + Math.random() * 5.5;
    }
  }

  /** A chord: the pad's notes and the root, swelling in and fading out over `length`, overlapping the next. */
  private chord(graph: AudioGraph, chord: (typeof CHORDS)[number], at: number, length: number): void {
    const { ctx } = graph;
    const attack = 5;
    const release = 7;
    const end = at + length + release;
    const voice = (freq: number, type: OscillatorType, detuneCents: number, level: number, into: AudioNode) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = detuneCents;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(level, at + attack);
      g.gain.setValueAtTime(level, at + length);
      g.gain.linearRampToValueAtTime(0, end);
      osc.connect(g).connect(into);
      osc.start(at);
      osc.stop(end + 0.1);
    };
    for (const m of chord.pad) {
      voice(hz(m), "sine", -4, 0.05, this.pad!.filter);
      voice(hz(m), "triangle", 5, 0.03, this.pad!.filter);
    }
    voice(hz(chord.root), "sine", 0, 0.06, graph.music);
  }

  /** A bell: a soft, slightly inharmonic note, placed in the stereo field, echoing away. */
  private bell(graph: AudioGraph, midi: number, at: number, level: number): void {
    const { ctx } = graph;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.2 - 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 4);
    g.connect(pan);
    pan.connect(graph.music);
    pan.connect(this.delay!.input);
    const send = ctx.createGain();
    send.gain.value = 0.7;
    pan.connect(send).connect(graph.musicReverb);
    for (const [mult, gain] of [
      [1, 1],
      [2.76, 0.12],
      [5.4, 0.04],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = hz(midi) * mult;
      const pg = ctx.createGain();
      pg.gain.value = gain;
      osc.connect(pg).connect(g);
      osc.start(at);
      osc.stop(at + 4.1);
    }
  }
}

export const music = new Music();
