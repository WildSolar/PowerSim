/**
 * The sound effects, synthesised on the spot (sound.ts): a soft click for buttons, a quieter tick
 * for sliders and switches, a two-note ping as a letter that wants attention arrives, a lower one
 * for a vote's or an election's result, a small chord as the Year in Review opens, and a rising
 * "done" when something is ordered or enacted. All short and quiet; none plays when effects are
 * off or muted.
 *
 * installClickSounds hooks the whole page once: any button, tab or link clicked clicks, any slider
 * moved or box ticked ticks — so a new button needs nothing to sound like the rest.
 */

import { sound } from "./sound";

/** A note: a sine with a touch of its octave (a bell's brightness), a quick attack and a decay. */
function note(freq: number, startIn: number, decay: number, level: number, reverb = 0.6, bright = 0.18): void {
  const graph = sound.ensure();
  if (!graph || !sound.effectsOn()) return;
  const { ctx } = graph;
  const t = ctx.currentTime + startIn;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(level, t + 0.006);
  out.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  out.connect(graph.effects);
  if (reverb > 0) {
    const send = ctx.createGain();
    send.gain.value = reverb;
    out.connect(send).connect(graph.effectsReverb);
  }
  const partials: [number, number][] = [
    [1, 1],
    [2, bright],
  ];
  for (const [mult, gain] of partials) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq * mult;
    const g = ctx.createGain();
    g.gain.value = gain;
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  }
}

/** A very short, soft tick (filtered triangle). */
function blip(freq: number, decay: number, level: number): void {
  const graph = sound.ensure();
  if (!graph || !sound.effectsOn()) return;
  const { ctx } = graph;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.7, t + decay);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 3200;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  osc.connect(filter).connect(g).connect(graph.effects);
  osc.start(t);
  osc.stop(t + decay + 0.02);
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

let lastTick = 0;

export const sfx = {
  /** A button, a tab, a link. */
  click(): void {
    blip(1250 + Math.random() * 120, 0.045, 0.22);
  },
  /** A slider step or a switch: quieter, and not too often while dragging. */
  tick(): void {
    const now = performance.now();
    if (now - lastTick < 70) return;
    lastTick = now;
    blip(2100, 0.02, 0.1);
  },
  /** A letter that wants attention: two soft, rising notes. */
  ping(): void {
    note(hz(88), 0, 0.7, 0.16); // E6
    note(hz(93), 0.11, 0.9, 0.14); // A6
  },
  /** A vote's or an election's result, or a warning: lower, a little longer. */
  important(): void {
    note(hz(76), 0, 1.2, 0.18); // E5
    note(hz(71), 0.16, 1.5, 0.16); // B4
    note(hz(76), 0.32, 1.8, 0.12, 0.8, 0.1);
  },
  /** The Year in Review: a small chord, spread. */
  yearEnd(): void {
    [62, 66, 69, 74].forEach((m, i) => note(hz(m), i * 0.07, 2.6, 0.1, 0.9, 0.1)); // D major
  },
  /** Something ordered, built or enacted: a short rise. */
  confirm(): void {
    note(hz(79), 0, 0.35, 0.12, 0.3); // G5
    note(hz(84), 0.07, 0.6, 0.12, 0.4); // C6
  },
};

// Buttons whose click does something lasting — an order, a contract, a measure — say "done".
const CONFIRM = /^(order|build|enact|offer|reinforce|connect|roll it over|retain|issue|borrow|take up|publish|approve|apply)\b/i;

/** Clicks and ticks for the whole page, once. */
export function installClickSounds(): void {
  document.addEventListener(
    "click",
    (e) => {
      const target = e.target instanceof Element ? e.target : null;
      const el = target?.closest("button, [role='button'], a[href], summary, select");
      if (!el || (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return;
      if (el.closest("[data-silent]")) return;
      const text = el.textContent?.trim() ?? "";
      if (el instanceof HTMLButtonElement && CONFIRM.test(text)) sfx.confirm();
      else sfx.click();
    },
    true,
  );
  document.addEventListener(
    "input",
    (e) => {
      if (e.target instanceof HTMLInputElement && e.target.type === "range") sfx.tick();
    },
    true,
  );
  document.addEventListener(
    "change",
    (e) => {
      if (e.target instanceof HTMLInputElement && (e.target.type === "checkbox" || e.target.type === "radio")) sfx.tick();
    },
    true,
  );
}
