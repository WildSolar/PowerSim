import { Fragment, useEffect, useMemo, useState } from "react";
import { MAX_MARGIN_RP_KWH, SUGGESTED_MARGIN_RP_KWH } from "../config/dynamicTariff";
import { WHOLESALE_HEDGED_SHARE, type Commodity } from "../config/market";
import { approval } from "../sim/approval";
import { toDateMs } from "../sim/calendar";
import { estimateUptake } from "../sim/dynamicTariff";
import { market } from "../sim/market";
import { stock } from "../sim/stock";
import { useSimDay, useTariff } from "../sim/store";
import type { TariffSheet } from "../sim/tariff";
import { householdBillChf, householdEnergyRpKWh, previewReaction } from "../sim/tariffApproval";
import { energyPriceCap } from "../sim/tariffCap";
import { BASE_FEE_MAX_CHF_PER_MONTH, TARIFF_CAP_MARGIN } from "../config/tariff";
import { sheetPrices, tariffStore } from "../sim/tariffStore";
import { businessEnergyRpKWh, marketAccess, marketOfferRpKWh } from "../sim/marketAccess";
import { MARKET_ACCESS_MIN_KWH } from "../config/marketAccess";
import { feedInYearBaseRpKWh } from "../sim/feedIn";
import { FEED_IN_MINIMUM_RP_KWH } from "../config/feedIn";
import { DynamicPriceChart } from "./DynamicPriceChart";
import "./tariffControl.css";

const YEAR_MS = 365.25 * 24 * 3_600_000;

type SheetField = Exclude<keyof TariffSheet, "offPeakStartHour" | "offPeakEndHour" | "dynamicMarginRpKWh">;
type FieldGroup = "energy" | "network" | "solar" | "other";

const GROUP_LABEL: Record<FieldGroup, string> = {
  energy: "Energy price",
  network: "Network fee (regulated)",
  solar: "Solar",
  other: "Heat and charging",
};

const FIELDS: { key: SheetField; label: string; max: number; step: number; unit: string; scale?: number; title?: string; group: FieldGroup }[] = [
  { key: "energyOffPeakRpKWh", label: "Off-peak", max: 60, step: 0.5, unit: "Rp/kWh", group: "energy", title: "What households and small businesses in basic supply pay for the power itself" },
  { key: "energyPeakRpKWh", label: "Peak", max: 80, step: 0.5, unit: "Rp/kWh", group: "energy" },
  { key: "baseFeeChfPerMonth", label: "Base fee", max: BASE_FEE_MAX_CHF_PER_MONTH, step: 1, unit: "CHF/month", group: "network", title: "Per meter and month: the more of the grid's allowance it raises, the less each kWh carries" },
  { key: "networkOffPeakShare", label: "Off-peak rate", max: 100, step: 5, unit: "% of peak", scale: 100, group: "network", title: "How much cheaper the network fee is at night" },
  { key: "feedInBonusRpKWh", label: "Your bonus", max: 30, step: 0.5, unit: "Rp/kWh", group: "solar", title: "What the utility adds to the federal feed-in price, typically for the certificate of origin" },
  { key: "districtHeatingPriceRpKWh", label: "District heating", max: 40, step: 0.5, unit: "Rp/kWh", group: "other" },
  { key: "publicChargingAcRpKWh", label: "Public charging", max: 120, step: 0.5, unit: "Rp/kWh", group: "other", title: "At the municipality's own on-street chargers" },
  { key: "publicChargingDcRpKWh", label: "Fast charging", max: 150, step: 0.5, unit: "Rp/kWh", group: "other", title: "At the municipality's own fast-charging hubs" },
  { key: "publicChargingFleetRpKWh", label: "Lorry charging", max: 150, step: 0.5, unit: "Rp/kWh", group: "other", title: "At the municipality's own lorry charging parks" },
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
  return FIELDS.every(({ key }) => a[key] === b[key]) && a.dynamicMarginRpKWh === b.dynamicMarginRpKWh;
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
  const vsNow = (preview.billChf / householdBillChf(inForce, nowYear) - 1) * 100;
  const vsAverage = (preview.billChf / preview.benchmarkChf - 1) * 100;
  const unchanged = published && sameSheet(draft, tariffStore.sheetFor(targetYear));
  const cap = energyPriceCap(targetYear);
  const average = householdEnergyRpKWh(draft);
  const overCap = average > cap.capRpKWh + 0.005;
  const access = useMemo(() => marketAccess.stats(simDay), [Math.floor(simDay / 86_400_000)]);
  const pricesNow = sheetPrices(inForce, nowYear);
  const pricesNext = sheetPrices(draft, targetYear);

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
          <Fragment key={f.key}>
            <TariffRow
              field={f}
              now={inForce[f.key]}
              value={draft[f.key]}
              onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
              groupLabel={i === 0 || FIELDS[i - 1].group !== f.group ? GROUP_LABEL[f.group] : null}
            />
            {f.key === "feedInBonusRpKWh" && (
              <ComputedRow
                label="Feed-in, all in"
                now={feedInYearBaseRpKWh(nowYear) + inForce.feedInBonusRpKWh}
                next={feedInYearBaseRpKWh(targetYear) + draft.feedInBonusRpKWh}
                title={`The federal price — the quarter's reference market price, weighted by when solar produces, but at least ${FEED_IN_MINIMUM_RP_KWH} Rp — and your bonus, over the year`}
              />
            )}
            {f.key === "networkOffPeakShare" && (
              <>
                <ComputedRow label="Off-peak" now={pricesNow.networkOffPeakRpKWh} next={pricesNext.networkOffPeakRpKWh} title="Set by the regulator from what the grid costs: you choose only how it is raised" />
                <ComputedRow label="Peak" now={pricesNow.networkPeakRpKWh} next={pricesNext.networkPeakRpKWh} />
                <span className="tech-prices-group">All in, per kWh</span>
                <ComputedRow label="Off-peak" now={pricesNow.offPeakRpKWh} next={pricesNext.offPeakRpKWh} title="Energy and network fee together, without the base fee" />
                <ComputedRow label="Peak" now={pricesNow.peakRpKWh} next={pricesNext.peakRpKWh} />
              </>
            )}
          </Fragment>
        ))}
      </div>

      <DynamicTariffDraft
        draft={draft}
        inForce={inForce}
        year={targetYear}
        atMs={simDay}
        onSpread={(v) => setDraft((d) => ({ ...d, dynamicMarginRpKWh: v }))}
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
        <div
          className="tariff-preview-line"
          title={`What the regulator allows for the energy: the power bought for ${targetYear} (${cap.wholesaleRpKWh.toFixed(1)} Rp) and the concession fee (${cap.concessionRpKWh.toFixed(1)} Rp) per kWh, plus ${Math.round(TARIFF_CAP_MARGIN * 100)}% return and ${cap.salesRpKWh.toFixed(1)} Rp of sales costs — and ${cap.feedInRpKWh.toFixed(1)} Rp for what solar fed in cost above its market value over the last twelve months (the federal minimum and your bonus)`}
        >
          <span>Average energy price, against the regulator&apos;s ceiling</span>
          <span className={overCap ? "up" : ""}>
            {average.toFixed(1)} of {cap.capRpKWh.toFixed(1)} Rp/kWh
          </span>
        </div>
        <div
          className="tariff-preview-line"
          title={`Businesses using ${(MARKET_ACCESS_MIN_KWH / 1000).toLocaleString("en-GB")} MWh a year or more may buy their energy on the open market — and once gone, don't come back. They still pay the network fee here. Each October, those still in basic supply weigh next year's energy price against a supplier's offer.`}
        >
          <span>
            Large businesses on the open market ({access.sites} of {access.eligible})
          </span>
          <span>
            {Math.round(access.businessShare * 100)}% of business use · offer for {targetYear}: {marketOfferRpKWh(targetYear).toFixed(1)} vs your {businessEnergyRpKWh(draft).toFixed(1)} Rp/kWh
          </span>
        </div>
        <div className="tariff-preview-line">
          <span>Expected reaction</span>
          <span className={`tariff-reaction ${reaction.tone}`}>{reaction.label}</span>
        </div>
      </div>

      <div className="tariff-publish">
        {overCap && (
          <p className="tariff-over-cap">
            Over the ceiling: ElCom, the federal regulator, holds a monopoly utility&apos;s energy price to its costs plus a reasonable return —{" "}
            {cap.capRpKWh.toFixed(1)} Rp/kWh on average for a typical household. Lower the energy prices to publish.
          </p>
        )}
        <button className="tariff-publish-btn" disabled={unchanged || overCap} onClick={() => tariffStore.publish(draft, simDay)}>
          {published ? `Publish again for ${targetYear}` : `Publish for ${targetYear}`}
        </button>
        <span className="tariff-deadline">
          {published
            ? unchanged
              ? `Published. You can revise it until ${dayLabel(tariffStore.deadlineMs(targetYear))}.`
              : `Replaces the one already published.`
            : `Due by ${dayLabel(tariffStore.deadlineMs(targetYear))}. If none is published by then, the game stops there and asks whether to keep this year’s prices.`}
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
  groupLabel,
}: {
  field: (typeof FIELDS)[number];
  now: number;
  value: number;
  onChange: (v: number) => void;
  groupLabel: string | null;
}) {
  const scale = field.scale ?? 1;
  return (
    <>
      {groupLabel && <span className="tech-prices-group">{groupLabel}</span>}
      <span className="tariff-label" title={field.title}>
        {field.label}
      </span>
      <span className="tech-prices-value">{Math.round(now * scale * 10) / 10}</span>
      <input
        type="number"
        min={0}
        max={field.max}
        step={field.step}
        value={Math.round(value * scale * 10) / 10}
        className={value !== now ? "changed" : ""}
        aria-label={`${field.label}, next year`}
        onChange={(e) => onChange(Math.max(0, Math.min(field.max, Number(e.target.value) || 0)) / scale)}
      />
      <span className="tariff-unit">{field.unit}</span>
    </>
  );
}

/** A price that follows from others (the regulated network fee, the price all in): this year's and
 * next year's, not to be set. */
function ComputedRow({ label, now, next, title }: { label: string; now: number; next: number; title?: string }) {
  return (
    <>
      <span className="tariff-label tariff-computed" title={title}>
        {label}
      </span>
      <span className="tech-prices-value">{now.toFixed(1)}</span>
      <span className={`tech-prices-value tariff-computed-next${Math.abs(next - now) >= 0.05 ? " changed" : ""}`}>{next.toFixed(1)}</span>
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
  const offered = draft.dynamicMarginRpKWh > 0;
  // Who would sign up, with the town as it is today (it pauses while the town hall is open).
  const uptake = useMemo(
    () => (offered ? estimateUptake(stock.getAll(), draft, year, atMs) : null),
    [offered, draft.dynamicMarginRpKWh, draft.energyOffPeakRpKWh, draft.energyPeakRpKWh, draft.baseFeeChfPerMonth, draft.networkOffPeakShare, year, Math.floor(atMs / 86_400_000)],
  );
  return (
    <div className="dyn-draft">
      <div className="dyn-draft-head">
        <label className="dyn-draft-toggle">
          <input type="checkbox" checked={offered} onChange={(e) => onSpread(e.target.checked ? SUGGESTED_MARGIN_RP_KWH : 0)} />
          <span>Offer a dynamic tariff</span>
        </label>
        <span className="tariff-unit">{inForce.dynamicMarginRpKWh > 0 ? `Now: margin ${inForce.dynamicMarginRpKWh} Rp/kWh` : "Not offered now"}</span>
      </div>
      <p className="tech-prices-note">
        Households may choose it instead of the time-of-use tariff. They pay the next day&apos;s market prices, published the day before — each hour&apos;s day-ahead price and your margin, plus the network fee. Sunny days are cheapest at midday, still winter evenings dearest; those on it plan their charging, heating and washing day by day.
      </p>
      {offered && (
        <>
          <div className="dyn-draft-spread">
            <span className="tariff-label">Your margin on the day-ahead price</span>
            <input
              type="number"
              min={0.5}
              max={MAX_MARGIN_RP_KWH}
              step={0.5}
              value={draft.dynamicMarginRpKWh}
              className={draft.dynamicMarginRpKWh !== inForce.dynamicMarginRpKWh ? "changed" : ""}
              aria-label="Dynamic tariff margin"
              onChange={(e) => onSpread(Math.max(0.5, Math.min(MAX_MARGIN_RP_KWH, Math.round((Number(e.target.value) || 0.5) * 2) / 2)))}
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

/** Prices nobody in the town sets: what they are this month, and a year ago — and what next year's
 * power, mostly bought ahead, costs. */
function MarketPrices({ atMs }: { atMs: number }) {
  const nextYear = new Date(toDateMs(atMs)).getUTCFullYear() + 1;
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
      <p className="tech-prices-note">
        The utility buys most of a year's power ahead, a share in each of the three years before, and the rest month by month. For {nextYear}, {Math.round(WHOLESALE_HEDGED_SHARE * 100)}% is
        bought already, at about <strong>{market.hedgedPrice(nextYear).toFixed(1)} Rp/kWh</strong> (this year {market.hedgedPrice(nextYear - 1).toFixed(1)}); a supply crisis
        would still lift it.
      </p>
    </div>
  );
}
