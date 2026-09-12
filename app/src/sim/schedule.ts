/**
 * A smooth "open these hours" occupancy curve: near-0 outside [openHour,
 * closeHour), a plateau near 1 inside, with a soft (sigmoid) transition at each
 * edge rather than a hard step — the same no-discontinuities principle behind
 * heatPump.ts's daily-mean-gated threshold, applied to a business-hours shape
 * instead of a temperature one. None of commercial.ts's schedules cross midnight,
 * so this deliberately doesn't handle wraparound.
 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function businessHoursShape(hourOfDay: number, openHour: number, closeHour: number, transitionHours = 0.5): number {
  const rampUp = sigmoid((hourOfDay - openHour) / transitionHours);
  const rampDown = sigmoid((closeHour - hourOfDay) / transitionHours);
  return Math.min(rampUp, rampDown);
}

/** dayOfWeek as returned by calendar.ts's dayOfWeek: 0 (Sunday) - 6 (Saturday). */
export function isWeekday(dow: number): boolean {
  return dow >= 1 && dow <= 5;
}
