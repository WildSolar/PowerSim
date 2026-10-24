import { Fragment, useEffect, useMemo, useState } from "react";
import { MAX_MARGIN_RP_KWH, SUGGESTED_MARGIN_RP_KWH } from "../config/dynamicTariff";
import { WHOLESALE_HEDGED_SHARE, type Commodity } from "../config/market";
import { approval } from "../sim/approval";
import { toDateMs } from "../sim/calendar";
import { estimateUptake } from "../sim/dynamicTariff";
import { chargingAllInRpKWh, chargingSolarAllInRpKWh, estimateChargingUptake } from "../sim/chargingTariff";
import { townSurplus } from "../sim/townSurplus";
import { MAX_CHARGING_NETWORK_DISCOUNT } from "../config/chargingTariff";
import { market } from "../sim/market";
import { stock } from "../sim/stock";
import { useSimDay, useTariff } from "../sim/store";
import { withStandardPrice, type TariffSheet } from "../sim/tariff";
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

// The charging tariff's fields have a card of their own (ChargingTariffDraft).
type ChargingField = "chargingTariffOffered" | "chargingEnergyRpKWh" | "chargingMeterFeeChfPerMonth" | "chargingControlled" | "chargingNetworkDiscount" | "chargingSolarEnergyRpKWh";
const CHARGING_FIELDS: ChargingField[] = [
  "chargingTariffOffered",
  "chargingEnergyRpKWh",
  "chargingMeterFeeChfPerMonth",
  "chargingControlled",
  "chargingNetworkDiscount",
  "chargingSolarEnergyRpKWh",
];
type SheetField = Exclude<keyof TariffSheet, "offPeakStartHour" | "offPeakEndHour" | "dynamicMarginRpKWh" | ChargingField>;
type FieldGroup = "energy" | "network" | "solar" | "other" | "chargers";

const GROUP_LABEL: Record<FieldGroup, string> = {
  energy: "Energy price",
  network: "Network fee (regulated)",
  solar: "Solar",
  other: "Heat",
  chargers: "Your public chargers",
};

const FIELDS: { key: SheetField; label: string; max: number; step: number; unit: string; scale?: number; title?: string; group: FieldGroup }[] = [
  { key: "energyOffPeakRpKWh", label: "Off-peak", max: 60, step: 0.5, unit: "Rp/kWh", group: "energy", title: "What households and small businesses in basic supply pay for the power itself" },
  { key: "energyPeakRpKWh", label: "Peak", max: 80, step: 0.5, unit: "Rp/kWh", group: "energy" },
  { key: "baseFeeChfPerMonth", label: "Base fee", max: BASE_FEE_MAX_CHF_PER_MONTH, step: 1, unit: "CHF/month", group: "network", title: "Per meter and month: the more of the grid's allowance it raises, the less each kWh carries" },
  { key: "networkOffPeakShare", label: "Off-peak rate", max: 100, step: 5, unit: "% of peak", scale: 100, group: "network", title: "How much cheaper the network fee is at night" },
  { key: "feedInBonusRpKWh", label: "Your bonus", max: 30, step: 0.5, unit: "Rp/kWh", group: "solar", title: "What the utility adds to the federal feed-in price, typically for the certificate of origin" },
  { key: "districtHeatingPriceRpKWh", label: "District heating", max: 40, step: 0.5, unit: "Rp/kWh", group: "other" },
  { key: "publicChargingAcRpKWh", label: "On-street", max: 120, step: 0.5, unit: "Rp/kWh", group: "chargers", title: "At the municipality's own on-street chargers (and in its car parks), outside the night and solar hours" },
  { key: "publicChargingAcNightRpKWh", label: "…at night", max: 120, step: 0.5, unit: "Rp/kWh", group: "chargers", title: "In the night rate's hours. Cheaper, and the chargers charge the cars parked overnight then" },
  { key: "publicChargingAcSolarRpKWh", label: "…in solar hours", max: 120, step: 0.5, unit: "Rp/kWh", group: "chargers", title: "When the town's own solar is forecast to make more than it uses. On the street only drivers at home that day charge then — at weekends, and about one weekday in four" },
  { key: "publicChargingDcRpKWh", label: "Fast charging", max: 150, step: 0.5, unit: "Rp/kWh", group: "chargers", title: "At the municipality's own fast-charging hubs, outside the night and solar hours" },
  { key: "publicChargingDcNightRpKWh", label: "…at night", max: 150, step: 0.5, unit: "Rp/kWh", group: "chargers", title: "In the night rate's hours. Cheaper, and some drivers come by then instead — leaving the hub room for more" },
  { key: "publicChargingDcSolarRpKWh", label: "…in solar hours", max: 150, step: 0.5, unit: "Rp/kWh", group: "chargers", title: "When the town's own solar is forecast to make more than it uses. Cheaper, and some drivers come by then instead" },
  { key: "publicChargingFleetRpKWh", label: "Lorry charging", max: 150, step: 0.5, unit: "Rp/kWh", group: "chargers", title: "At the municipality's own lorry charging parks, outside the night and solar hours" },
  { key: "publicChargingFleetNightRpKWh", label: "…at night", max: 150, step: 0.5, unit: "Rp/kWh", group: "chargers", title: "In the night rate's hours. Cheaper, and some lorries charge overnight instead — leaving the park room for more" },
  { key: "publicChargingFleetSolarRpKWh", label: "…in solar hours", max: 150, step: 0.5, unit: "Rp/kWh", group: "chargers", title: "When the town's own solar is forecast to make more than it uses. Cheaper, and some lorries charge at their midday break" },
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
  return FIELDS.every(({ key }) => a[key] === b[key]) && a.dynamicMarginRpKWh === b.dynamicMarginRpKWh && CHARGING_FIELDS.every((key) => a[key] === b[key]);
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
  const chargingOverCap = draft.chargingTariffOffered && draft.chargingEnergyRpKWh > cap.capRpKWh + 0.005;
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
              onChange={(v) => setDraft((d) => withStandardPrice(d, f.key, v))}
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

      <ChargingTariffDraft draft={draft} inForce={inForce} year={targetYear} atMs={simDay} capRpKWh={cap.capRpKWh} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />

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
        {chargingOverCap && (
          <p className="tariff-over-cap">
            The charging price is over the regulator&apos;s ceiling of {cap.capRpKWh.toFixed(1)} Rp/kWh for the energy. Lower it to publish.
          </p>
        )}
        <button className="tariff-publish-btn" disabled={unchanged || overCap || chargingOverCap} onClick={() => tariffStore.publish(draft, simDay)}>
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
  const uptake = useMemo(() => {
    if (!offered) return null;
    // Households whose car would go on the charging meter weigh this one without it.
    const meters = draft.chargingTariffOffered ? estimateChargingUptake(stock.getAll(), draft, year, atMs).households : null;
    return estimateUptake(stock.getAll(), draft, year, atMs, (key) => meters?.has(key) ?? false);
  }, [
    offered,
    draft.dynamicMarginRpKWh,
    draft.energyOffPeakRpKWh,
    draft.energyPeakRpKWh,
    draft.baseFeeChfPerMonth,
    draft.networkOffPeakShare,
    draft.chargingTariffOffered,
    draft.chargingEnergyRpKWh,
    draft.chargingMeterFeeChfPerMonth,
    draft.chargingControlled,
    draft.chargingNetworkDiscount,
    year,
    Math.floor(atMs / 86_400_000),
  ]);
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

/** The charging tariff for next year: a wallbox on its own meter (chargingTariff.ts) — its price, the
 * meter's fee, when it may charge, and the network discount for one the utility controls — with who
 * would likely sign up, the town as it is today. */
function ChargingTariffDraft({
  draft,
  inForce,
  year,
  atMs,
  capRpKWh,
  onChange,
}: {
  draft: TariffSheet;
  inForce: TariffSheet;
  year: number;
  atMs: number;
  capRpKWh: number;
  onChange: (patch: Partial<TariffSheet>) => void;
}) {
  const offered = draft.chargingTariffOffered;
  const uptake = useMemo(
    () => (offered ? estimateChargingUptake(stock.getAll(), draft, year, atMs) : null),
    [
      offered,
      draft.chargingEnergyRpKWh,
      draft.chargingMeterFeeChfPerMonth,
      draft.chargingControlled,
      draft.chargingNetworkDiscount,
      draft.chargingSolarEnergyRpKWh,
      draft.energyOffPeakRpKWh,
      draft.energyPeakRpKWh,
      draft.baseFeeChfPerMonth,
      draft.networkOffPeakShare,
      year,
      Math.floor(atMs / 86_400_000),
    ],
  );
  const prices = sheetPrices(draft, year);
  const allIn = chargingAllInRpKWh(draft, year);
  // Days of the year with solar hours, at the town's solar today (worked out once a day).
  const solarDays = useMemo(
    () => (offered && draft.chargingControlled ? Math.round(townSurplus.solarDayShare(year, atMs) * 365) : 0),
    [offered, draft.chargingControlled, year, Math.floor(atMs / 86_400_000)],
  );
  const number = (key: "chargingEnergyRpKWh" | "chargingMeterFeeChfPerMonth" | "chargingSolarEnergyRpKWh", min: number, max: number, step: number) => (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft[key]}
      className={draft[key] !== inForce[key] ? "changed" : ""}
      onChange={(e) => onChange({ [key]: Math.max(min, Math.min(max, Math.round((Number(e.target.value) || 0) / step) * step)) })}
    />
  );
  const inForceLabel = inForce.chargingTariffOffered
    ? `Now: ${inForce.chargingEnergyRpKWh} Rp/kWh, ${inForce.chargingControlled ? "utility-controlled" : "night only"}`
    : "Not offered now";
  return (
    <div className="dyn-draft">
      <div className="dyn-draft-head">
        <label className="dyn-draft-toggle">
          <input type="checkbox" checked={offered} onChange={(e) => onChange({ chargingTariffOffered: e.target.checked })} />
          <span>Offer a charging tariff</span>
        </label>
        <span className="tariff-unit">{inForceLabel}</span>
      </div>
      <p className="tech-prices-note">
        A wallbox on its own meter, at a price of its own, in return for when it may charge: only in the night rate, or whenever the utility decides — which it uses to fill the night&apos;s quietest hours. Households with a wallbox and an electric car sign up on 1 January if it saves them more than the bother. The meter has its own monthly fee. A wallbox the utility controls may pay less network fee; the regulator&apos;s allowance stays the same, so the rest of the town makes it up in the years after.
      </p>
      {offered && (
        <>
          <div className="dyn-draft-spread">
            <span className="tariff-label">Energy price on the charging meter</span>
            {number("chargingEnergyRpKWh", 0, Math.floor(capRpKWh * 2) / 2, 0.5)}
            <span className="tariff-unit">Rp/kWh</span>
          </div>
          <div className="dyn-draft-spread">
            <span className="tariff-label">Meter fee</span>
            {number("chargingMeterFeeChfPerMonth", 0, 30, 1)}
            <span className="tariff-unit">CHF/month</span>
          </div>
          <div className="dyn-draft-spread charge-draft-options" role="radiogroup" aria-label="When it may charge">
            <span className="tariff-label">When it may charge</span>
            <label>
              <input type="radio" checked={!draft.chargingControlled} onChange={() => onChange({ chargingControlled: false, chargingNetworkDiscount: 0 })} /> Night rate only
            </label>
            <label>
              <input type="radio" checked={draft.chargingControlled} onChange={() => onChange({ chargingControlled: true })} /> Utility-controlled
            </label>
          </div>
          {draft.chargingControlled && (
            <div className="dyn-draft-spread">
              <span className="tariff-label" title="Off the network fee for a wallbox the utility controls, as utilities give heat pumps; everyone else's fee makes it up in the years after">
                Network fee discount
              </span>
              <input
                type="number"
                min={0}
                max={MAX_CHARGING_NETWORK_DISCOUNT * 100}
                step={5}
                value={Math.round(draft.chargingNetworkDiscount * 100)}
                className={draft.chargingNetworkDiscount !== inForce.chargingNetworkDiscount ? "changed" : ""}
                onChange={(e) => onChange({ chargingNetworkDiscount: Math.max(0, Math.min(MAX_CHARGING_NETWORK_DISCOUNT, Math.round((Number(e.target.value) || 0) / 5) * 0.05)) })}
              />
              <span className="tariff-unit">%</span>
            </div>
          )}
          {draft.chargingControlled && (
            <>
              <div className="dyn-draft-spread">
                <span
                  className="tariff-label"
                  title="For what controlled wallboxes draw in the town's solar hours — when its own solar and wind are forecast to make more than it uses. Cars at home then charge in them: every weekend, and some on weekdays."
                >
                  Energy price in solar hours
                </span>
                {number("chargingSolarEnergyRpKWh", 0, Math.floor(capRpKWh * 2) / 2, 0.5)}
                <span className="tariff-unit">Rp/kWh</span>
              </div>
              <div className="tariff-preview-line">
                <span>Solar hours, at the town&apos;s solar today</span>
                <span>
                  {solarDays === 0 ? "none yet — the town makes less than it uses even at noon" : `on about ${solarDays} days a year`} · all in {chargingSolarAllInRpKWh(draft, year).toFixed(1)} Rp/kWh
                </span>
              </div>
            </>
          )}
          <div className="tariff-preview-line">
            <span>All in, per kWh on the charging meter</span>
            <span>
              {allIn.toFixed(1)} Rp/kWh · household night rate {prices.offPeakRpKWh.toFixed(1)}, day {prices.peakRpKWh.toFixed(1)}
            </span>
          </div>
          {uptake && (
            <div className="tariff-preview-line dyn-uptake">
              <span>Likely to sign up</span>
              <span>
                {uptake.households.size.toLocaleString("en-GB")} of {uptake.eligible.toLocaleString("en-GB")} households with a wallbox and an electric car
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
