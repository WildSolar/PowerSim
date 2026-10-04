import { useEffect, useState } from "react";
import type { Commodity } from "../config/market";
import { approval } from "../sim/approval";
import { toDateMs } from "../sim/calendar";
import { market } from "../sim/market";
import { useSimDay, useTariff } from "../sim/store";
import type { TariffSheet } from "../sim/tariff";
import { householdBillChf, previewReaction } from "../sim/tariffApproval";
import { tariffStore } from "../sim/tariffStore";
import "./tariffControl.css";

const YEAR_MS = 365.25 * 24 * 3_600_000;

type SheetField = Exclude<keyof TariffSheet, "offPeakStartHour" | "offPeakEndHour">;

const FIELDS: { key: SheetField; label: string; max: number; title?: string; group: "electricity" | "other" }[] = [
  { key: "offPeakPriceRpKWh", label: "Off-peak", max: 60, group: "electricity" },
  { key: "peakPriceRpKWh", label: "Peak", max: 80, group: "electricity" },
  { key: "feedInPriceRpKWh", label: "Solar feed-in", max: 40, group: "electricity", title: "What the utility pays for solar power fed into the grid" },
  { key: "districtHeatingPriceRpKWh", label: "District heating", max: 40, group: "other" },
  { key: "publicChargingAcRpKWh", label: "Public charging", max: 120, group: "other", title: "At the municipality's own on-street chargers" },
  { key: "publicChargingDcRpKWh", label: "Fast charging", max: 150, group: "other", title: "At the municipality's own fast-charging hubs" },
  { key: "publicChargingFleetRpKWh", label: "Lorry charging", max: 150, group: "other", title: "At the municipality's own lorry charging parks" },
];

const MARKETS: { id: Commodity; label: string; unit: string; digits: number }[] = [
  { id: "wholesale", label: "Wholesale electricity", unit: "Rp/kWh", digits: 1 },
  { id: "gas", label: "Natural gas", unit: "Rp/kWh", digits: 1 },
  { id: "oil", label: "Heating oil", unit: "Rp/L", digits: 0 },
  { id: "petrol", label: "Petrol and diesel", unit: "Rp/L", digits: 0 },
];

function yearOf(atMs: number): number {
  return new Date(toDateMs(atMs)).getUTCFullYear();
}

function dayLabel(atMs: number): string {
  return new Date(toDateMs(atMs)).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function hours(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

function signedPct(pct: number): string {
  const r = Math.round(pct);
  return r === 0 ? "±0%" : `${r > 0 ? "+" : "−"}${Math.abs(r)}%`;
}

function sameSheet(a: TariffSheet, b: TariffSheet): boolean {
  return FIELDS.every(({ key }) => a[key] === b[key]);
}

/** The utility's prices: the tariff in force, next year's to publish, and the market prices it
 * doesn't set (tariffStore.ts, market.ts). */
export function TariffControl() {
  useTariff(); // re-render when a tariff is published
  const simDay = useSimDay();
  const nowYear = yearOf(simDay);
  const targetYear = tariffStore.publishableYear(simDay);
  const inForce = tariffStore.sheetFor(nowYear);
  const published = tariffStore.isPublished(targetYear);
  const [draft, setDraft] = useState<TariffSheet>(() => ({ ...tariffStore.sheetFor(targetYear) }));
  // A new year to publish for: start from what would otherwise apply.
  useEffect(() => setDraft({ ...tariffStore.sheetFor(targetYear) }), [targetYear]);

  const preview = previewReaction(draft, targetYear);
  const reaction = approval.reactionTo(preview.change);
  const vsNow = (preview.billChf / householdBillChf(inForce) - 1) * 100;
  const vsAverage = (preview.billChf / preview.benchmarkChf - 1) * 100;
  const unchanged = published && sameSheet(draft, tariffStore.sheetFor(targetYear));

  return (
    <div className="tariff-control">
      <div className="tariff-title">Electricity and heat tariff</div>
      <p className="tech-prices-note">
        You publish next year’s tariff once a year, by the end of August; it takes effect on 1 January. Until then you can publish again.
      </p>

      <div className="tariff-grid">
        <span />
        <span className="tech-prices-head">{nowYear}</span>
        <span className="tech-prices-head">{targetYear}</span>
        <span />
        <span className="tech-prices-group">
          Electricity
          <span className="tariff-window">
            Off-peak {hours(inForce.offPeakStartHour)}–{hours(inForce.offPeakEndHour)}
          </span>
        </span>
        {FIELDS.map((f, i) => (
          <TariffRow
            key={f.key}
            field={f}
            now={inForce[f.key]}
            value={draft[f.key]}
            onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
            groupStart={i > 0 && FIELDS[i - 1].group !== f.group}
          />
        ))}
      </div>

      <div className="tariff-preview">
        <div className="tariff-preview-bill">
          <span>A typical household’s electricity</span>
          <strong>CHF {Math.round(preview.billChf).toLocaleString("en-GB")} a year</strong>
        </div>
        <div className="tariff-preview-line">
          <span>Compared with {nowYear}</span>
          <span className={vsNow > 0.5 ? "up" : vsNow < -0.5 ? "down" : ""}>{signedPct(vsNow)}</span>
        </div>
        <div className="tariff-preview-line">
          <span>Compared with the Swiss average (CHF {Math.round(preview.benchmarkChf).toLocaleString("en-GB")})</span>
          <span className={vsAverage > 0.5 ? "up" : vsAverage < -0.5 ? "down" : ""}>{signedPct(vsAverage)}</span>
        </div>
        <div className="tariff-preview-line">
          <span>Expected reaction</span>
          <span className={`tariff-reaction ${reaction.tone}`}>{reaction.label}</span>
        </div>
      </div>

      <div className="tariff-publish">
        <button className="tariff-publish-btn" disabled={unchanged} onClick={() => tariffStore.publish(draft, simDay)}>
          {published ? `Publish again for ${targetYear}` : `Publish for ${targetYear}`}
        </button>
        <span className="tariff-deadline">
          {published
            ? unchanged
              ? `Published. You can revise it until ${dayLabel(tariffStore.deadlineMs(targetYear))}.`
              : `Replaces the one already published.`
            : `If you publish nothing by ${dayLabel(tariffStore.deadlineMs(targetYear))}, this year’s prices carry over.`}
        </span>
      </div>

      <div className="tariff-divider" />
      <MarketPrices atMs={simDay} />
    </div>
  );
}

function TariffRow({
  field,
  now,
  value,
  onChange,
  groupStart,
}: {
  field: (typeof FIELDS)[number];
  now: number;
  value: number;
  onChange: (v: number) => void;
  groupStart: boolean;
}) {
  return (
    <>
      {groupStart && <span className="tech-prices-group">Heat and charging</span>}
      <span className="tariff-label" title={field.title}>
        {field.label}
      </span>
      <span className="tech-prices-value">{now}</span>
      <input
        type="number"
        min={0}
        max={field.max}
        step={0.5}
        value={value}
        className={value !== now ? "changed" : ""}
        aria-label={`${field.label}, next year`}
        onChange={(e) => onChange(Math.max(0, Math.min(field.max, Number(e.target.value) || 0)))}
      />
      <span className="tariff-unit">Rp/kWh</span>
    </>
  );
}

/** Prices nobody in the town sets: what they are this month, and a year ago. */
function MarketPrices({ atMs }: { atMs: number }) {
  return (
    <div className="tariff-markets">
      <div className="tariff-title">Energy markets</div>
      <p className="tech-prices-note">
        World market prices, including the federal CO₂ levy on heating fuels. Nobody in town sets them: the utility buys its power at the wholesale price, and households pay for fuel at these.
      </p>
      <div className="tech-prices-grid">
        <span />
        <span className="tech-prices-head">Now</span>
        <span className="tech-prices-head">On a year ago</span>
        {MARKETS.map((m) => {
          const now = market.price(m.id, atMs);
          const before = market.price(m.id, atMs - YEAR_MS);
          const pct = (now / before - 1) * 100;
          return (
            <span key={m.id} className="tariff-market-row">
              <span>{m.label}</span>
              <span className="tech-prices-value">
                {now.toFixed(m.digits)} <span className="tariff-unit">{m.unit}</span>
              </span>
              <span className={`tech-prices-value${pct > 0.5 ? " up" : pct < -0.5 ? " down" : ""}`}>{signedPct(pct)}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
