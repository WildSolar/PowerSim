import { useMemo } from "react";
import { MOBILITY_MODE_CATALOG, type MobilityMode } from "../config/mobility";
import type { Building } from "../data/types";
import { toDateMs } from "../sim/calendar";
import { fleets } from "../sim/fleet";
import { mobilityCensus, type MobilityCensus } from "../sim/mobility";
import { MOBILITY_MODE_ORDER } from "../sim/mobilitySystems";
import "./modalSplit.css";

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–";
}

function total(c: MobilityCensus): number {
  return c.byMode.car + c.byMode.bike + c.byMode.other;
}

/** How residents get around — the modal split and the vehicles behind it, at the start of the game
 * and now. A municipality knows this from the federal mobility survey and the vehicle register, so
 * it's shown for free. */
export function ModalSplitSection({ buildings, simDayMs }: { buildings: Building[]; simDayMs: number }) {
  const start = useMemo(() => mobilityCensus(buildings, 0), [buildings]);
  const now = useMemo(() => mobilityCensus(buildings, simDayMs), [buildings, simDayMs]);
  const fleet = useMemo(() => fleets.census(buildings, simDayMs), [buildings, simDayMs]);
  const startYear = new Date(toDateMs(0)).getUTCFullYear();
  const nowTotal = total(now);
  const startTotal = total(start);

  const rows: { key: string; label: string; start: string; now: string; sub?: boolean }[] = [];
  for (const mode of MOBILITY_MODE_ORDER as MobilityMode[]) {
    const spec = MOBILITY_MODE_CATALOG[mode];
    rows.push({ key: mode, label: `${spec.icon} ${spec.label}`, start: pct(start.byMode[mode], startTotal), now: pct(now.byMode[mode], nowTotal) });
    if (mode === "car") rows.push({ key: "car-ev", label: "of which electric", start: pct(start.carsElectric, start.byMode.car), now: pct(now.carsElectric, now.byMode.car), sub: true });
    if (mode === "bike") rows.push({ key: "bike-e", label: "of which e-bikes", start: pct(start.bikesElectric, start.byMode.bike), now: pct(now.bikesElectric, now.byMode.bike), sub: true });
  }

  return (
    <>
      <h3 className="section-heading">Getting around</h3>
      <p className="modal-split-note">Residents by their main way of getting around — from the federal mobility survey and the vehicle register.</p>
      <div className="modal-split-bar" role="img" aria-label={MOBILITY_MODE_ORDER.map((m) => `${MOBILITY_MODE_CATALOG[m].label} ${pct(now.byMode[m], nowTotal)}`).join(", ")}>
        {MOBILITY_MODE_ORDER.map((m) => (
          <div
            key={m}
            title={`${MOBILITY_MODE_CATALOG[m].label}: ${pct(now.byMode[m], nowTotal)}`}
            style={{ flexGrow: now.byMode[m], background: MOBILITY_MODE_CATALOG[m].color }}
          />
        ))}
      </div>
      <table className="modal-split-table">
        <thead>
          <tr>
            <th />
            <th>{startYear}</th>
            <th>Now</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={r.sub ? "sub" : ""}>
              <td>
                {!r.sub && <span className="modal-split-swatch" style={{ background: MOBILITY_MODE_CATALOG[r.key as MobilityMode].color }} />}
                {r.label}
              </td>
              <td>{r.start}</td>
              <td>{r.now}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl style={{ marginTop: 8 }}>
        <dt>Residents' cars</dt>
        <dd>
          {now.byMode.car.toLocaleString("en-GB")} ({now.carsElectric.toLocaleString("en-GB")} electric)
        </dd>
        <dt>Business vans</dt>
        <dd>
          {fleet.vans.toLocaleString("en-GB")} ({fleet.vansElectric.toLocaleString("en-GB")} electric)
        </dd>
        <dt>Lorries</dt>
        <dd>
          {fleet.trucks.toLocaleString("en-GB")} ({fleet.trucksElectric.toLocaleString("en-GB")} electric)
        </dd>
      </dl>
    </>
  );
}
