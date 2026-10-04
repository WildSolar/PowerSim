import { useEffect, useMemo, useState } from "react";
import { MAX_SPREAD_RP_KWH, SUGGESTED_SPREAD_RP_KWH } from "../config/dynamicTariff";
import type { Commodity } from "../config/market";
import { approval } from "../sim/approval";
import { toDateMs } from "../sim/calendar";
import { estimateUptake } from "../sim/dynamicTariff";
import { market } from "../sim/market";
import { stock } from "../sim/stock";
import { useSimDay, useTariff } from "../sim/store";
import type { TariffSheet } from "../sim/tariff";
import { householdBillChf, previewReaction } from "../sim/tariffApproval";
import { tariffStore } from "../sim/tariffStore";
import { DynamicPriceChart } from "./DynamicPriceChart";
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
  return FIELDS.every(({ key }) => a[key] === b[key]) && a.dynamicSpreadRpKWh === b.dynamicSpreadRpKWh;
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

      <DynamicTariffDraft
        draft={draft}
        inForce={inForce}
        year={targetYear}
        atMs={simDay}
        onSpread={(v) => setDraft((d) => ({ ...d, dynamicSpreadRpKWh: v }))}
      />

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

/** The dynamic tariff on next year's sheet: whether it's offered, how far its price swings, what a
 * day of it looks like and who would sign up. */
function DynamicTariffDraft({
  draft,
  inForce,
  year,
  atMs,
  onSpread,
}: {
  draft: TariffSheet;
  inForce: TariffSheet;
  year: number;
  atMs: number;
  onSpread: (v: number) => void;
}) {
  const offered = draft.dynamicSpreadRpKWh > 0;
  // Who would sign up, with the town as it is today (it pauses while the town hall is open).
  const uptake = useMemo(
    () => (offered ? estimateUptake(stock.getAll(), draft, year, atMs) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [offered, draft.dynamicSpreadRpKWh, draft.offPeakPriceRpKWh, draft.peakPriceRpKWh, year, Math.floor(atMs / 86_400_000)],
  );
  return (
    <div className="dyn-draft">
      <div className="dyn-draft-head">
        <label className="dyn-draft-toggle">
          <input type="checkbox" checked={offered} onChange={(e) => onSpread(e.target.checked ? SUGGESTED_SPREAD_RP_KWH : 0)} />
          <span>Offer a dynamic tariff</span>
        </label>
        <span className="tariff-unit">{inForce.dynamicSpreadRpKWh > 0 ? `Now: ±${inForce.dynamicSpreadRpKWh} Rp/kWh` : "Not offered now"}</span>
      </div>
      <p className="tech-prices-note">
        Households may choose it instead of the time-of-use tariff. Its price follows the expected load on the grid hour by hour, around the same daily average: dearer in the evening peak, cheapest at night and, in summer, at midday.
      </p>
      {offered && (
        <>
          <div className="dyn-draft-spread">
            <span className="tariff-label">Price swing, either side</span>
            <input
              type="number"
              min={1}
              max={MAX_SPREAD_RP_KWH}
              step={1}
              value={draft.dynamicSpreadRpKWh}
              className={draft.dynamicSpreadRpKWh !== inForce.dynamicSpreadRpKWh ? "changed" : ""}
              aria-label="Dynamic tariff price swing"
              onChange={(e) => onSpread(Math.max(1, Math.min(MAX_SPREAD_RP_KWH, Math.round(Number(e.target.value) || 1))))}
            />
            <span className="tariff-unit">Rp/kWh</span>
          </div>
          <DynamicPriceChart sheet={draft} year={year} />
          {uptake && (
            <div className="tariff-preview-line dyn-uptake">
              <span>Likely to sign up</span>
              <span>
                {uptake.dwellings.size.toLocaleString("en-GB")} of {uptake.dwellingCount.toLocaleString("en-GB")} households · {uptake.heatPumps.size} of {uptake.heatPumpCount} heat pumps
              </span>
            </div>
          )}
        </>
      )}
    </div>
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
