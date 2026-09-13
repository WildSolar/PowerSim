import type { MunicipalityDataset } from "../data/types";
import { EMISSIONS_SOURCE_COLOR } from "../sim/emissions";
import { HEATING_SYSTEM_CATALOG, HEATING_SYSTEM_ORDER, WATER_HEATING_KIND_COLOR } from "../sim/heatingSystems";
import { sampleMunicipalityCategorySeries } from "../sim/history";
import { spaceHeatingKWhFor } from "../sim/yearReport";
import { useTariff } from "../sim/store";
import { tariffKey } from "../sim/tariff";
import { CONSUMPTION_CATEGORIES } from "./deviceCategories";
import { formatCO2 } from "./format";
import { PieChart, type PieSlice } from "./PieChart";
import { usePeriodPieEnergy } from "./usePeriodPieEnergy";
import { useYearEmissions, BASELINE_YEAR, NET_ZERO_TARGET_YEAR } from "./useYearEmissions";
import { useYearHeatingReport } from "./useYearHeatingReport";
import "./modal.css";
import "./panels.css";
import "./pieChart.css";
import "./reportCard.css";

export interface ReportCardModalProps {
  dataset: MunicipalityDataset;
  year: number;
  onClose: () => void;
}

/** The year-end "report card" — pops up automatically when yearEndWatcher.ts
 * pauses the clock at a calendar year boundary. Reuses PieChart and the
 * already-cached Year-tier energy pie (usePeriodPieEnergy) for the overall
 * total exactly as the Control panel's City stats tab does; the heating
 * technology breakdown and renewal tally are computed fresh for this specific
 * year by useYearHeatingReport. */
export function ReportCardModal({ dataset, year, onClose }: ReportCardModalProps) {
  const tariff = useTariff();

  const { energy: overallEnergy, loading: overallLoading } = usePeriodPieEnergy(
    dataset.name,
    "year",
    (times) => sampleMunicipalityCategorySeries(dataset.buildings, times, tariff, dataset.powerPlants),
    tariffKey(tariff),
  );
  const overallSlices: PieSlice[] = overallEnergy
    ? CONSUMPTION_CATEGORIES.map((c) => ({ key: c.key, label: c.label, icon: c.icon, color: c.color, valueKWh: overallEnergy[c.key] }))
    : [];

  const { data: heatingReport, loading: heatingLoading } = useYearHeatingReport(dataset.buildings, year);
  const spaceSlices: PieSlice[] = heatingReport
    ? HEATING_SYSTEM_ORDER.map((id) => ({
        key: id,
        label: HEATING_SYSTEM_CATALOG[id].label,
        icon: HEATING_SYSTEM_CATALOG[id].icon,
        color: HEATING_SYSTEM_CATALOG[id].color,
        valueKWh: spaceHeatingKWhFor(heatingReport.technology, id),
      }))
    : [];
  const waterSlices: PieSlice[] = heatingReport
    ? [
        {
          key: "heatPump",
          label: "Heat pump",
          icon: "🌬️",
          color: WATER_HEATING_KIND_COLOR.heatPump,
          valueKWh: heatingReport.technology.heatPumpWaterKWh,
        },
        {
          key: "direct",
          label: "Direct electric",
          icon: "🔌",
          color: WATER_HEATING_KIND_COLOR.direct,
          valueKWh: heatingReport.technology.directElectricWaterKWh,
        },
      ]
    : [];
  const totalRenewals = heatingReport ? heatingReport.renewals.reduce((sum, r) => sum + r.count, 0) : 0;

  const { data: emissions, loading: emissionsLoading } = useYearEmissions(dataset, year);
  const emissionSlices: PieSlice[] = emissions
    ? [
        { key: "electricity", label: "Electricity", icon: "⚡", color: EMISSIONS_SOURCE_COLOR.electricity, valueKWh: emissions.current.electricityKgCO2 },
        { key: "mobility", label: "Mobility (petrol/diesel)", icon: "🚗", color: EMISSIONS_SOURCE_COLOR.mobility, valueKWh: emissions.current.mobilityKgCO2 },
        {
          key: "districtHeating",
          label: "District heating",
          icon: "🏭",
          color: EMISSIONS_SOURCE_COLOR.districtHeating,
          valueKWh: emissions.current.districtHeatingKgCO2,
        },
        { key: "gas", label: "Gas heating", icon: "🔥", color: EMISSIONS_SOURCE_COLOR.gas, valueKWh: emissions.current.gasKgCO2 },
        { key: "oil", label: "Oil heating", icon: "🛢️", color: EMISSIONS_SOURCE_COLOR.oil, valueKWh: emissions.current.oilKgCO2 },
      ]
    : [];
  const vsBaselinePct =
    emissions && emissions.baseline.totalKgCO2 > 0
      ? ((emissions.current.totalKgCO2 - emissions.baseline.totalKgCO2) / emissions.baseline.totalKgCO2) * 100
      : 0;

  return (
    <div className="modal-backdrop">
      <div className="modal-shell report-card-shell">
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="modal-content">
          <h2>🎉 Year in Review — {year}</h2>
          <p>
            {dataset.name}, {year}: {dataset.buildings.length} buildings, {dataset.buildings.reduce((sum, b) => sum + b.dwellings.length, 0)}{" "}
            dwellings.
          </p>

          <h2 style={{ fontSize: 14, marginTop: 14 }}>Emissions</h2>
          {emissionsLoading || !emissions ? (
            <div className="loading-note">Computing…</div>
          ) : (
            <>
              <PieChart title={`${year} total`} slices={emissionSlices} formatValue={formatCO2} />
              <p style={{ fontSize: 12, margin: "8px 0 0" }}>
                {year === BASELINE_YEAR ? (
                  <>This is the baseline year — every future report compares back to this one.</>
                ) : (
                  <>
                    {formatCO2(emissions.current.totalKgCO2)} this year, {vsBaselinePct <= 0 ? "down" : "up"} {Math.abs(vsBaselinePct).toFixed(1)}%
                    from the {BASELINE_YEAR} baseline ({formatCO2(emissions.baseline.totalKgCO2)}).
                  </>
                )}{" "}
                Target: net zero by {NET_ZERO_TARGET_YEAR} — {Math.max(0, NET_ZERO_TARGET_YEAR - year)} years left.
              </p>
              <p style={{ fontSize: 12, color: "#888", margin: "4px 0 0" }}>
                Operational emissions only — what's actually burned or drawn from the grid, net of solar exported. Manufacturing a heat pump, an
                EV's battery, or a solar panel isn't counted.
              </p>
            </>
          )}

          <h2 style={{ fontSize: 14, marginTop: 14 }}>Energy by category</h2>
          {overallLoading || !overallEnergy ? (
            <div className="loading-note">Computing…</div>
          ) : (
            <PieChart title="All categories" slices={overallSlices} />
          )}

          <h2 style={{ fontSize: 14, marginTop: 14 }}>Heating energy by technology</h2>
          <p style={{ fontSize: 12, color: "#888", margin: "0 0 6px" }}>
            Heat actually delivered, across every fuel — not just the electricity "Energy by category" above covers, so the two totals aren't
            directly comparable.
          </p>
          {heatingLoading || !heatingReport ? (
            <div className="loading-note">Computing your year in review…</div>
          ) : (
            <div className="pie-chart-row">
              <PieChart title="Space heating" slices={spaceSlices} />
              <PieChart title="Water heating" slices={waterSlices} />
            </div>
          )}

          <h2 style={{ fontSize: 14, marginTop: 14 }}>Heating renewals this year</h2>
          {heatingLoading || !heatingReport ? (
            <div className="loading-note">Computing…</div>
          ) : heatingReport.renewals.length === 0 ? (
            <p>No heating systems were replaced this calendar year.</p>
          ) : (
            <>
              <p>
                {totalRenewals} building{totalRenewals === 1 ? "" : "s"} renewed their heating system this year.
              </p>
              <div className="renewal-tally">
                {heatingReport.renewals.map((r) => (
                  <div className="renewal-tally-row" key={`${r.previousSystem}>${r.system}`}>
                    <span className="renewal-tally-count">{r.count}×</span>
                    <span className="renewal-tally-label">
                      {HEATING_SYSTEM_CATALOG[r.previousSystem].icon} {HEATING_SYSTEM_CATALOG[r.previousSystem].label}
                      {" → "}
                      {HEATING_SYSTEM_CATALOG[r.system].icon} {HEATING_SYSTEM_CATALOG[r.system].label}
                      {r.previousSystem === r.system && <span className="ev-badge">like-for-like</span>}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
