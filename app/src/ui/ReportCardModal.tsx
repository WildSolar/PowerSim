import type { MunicipalityDataset } from "../data/types";
import { HEATING_SYSTEM_CATALOG, HEATING_SYSTEM_ORDER, WATER_HEATING_KIND_COLOR } from "../sim/heatingSystems";
import { sampleMunicipalityCategorySeries } from "../sim/history";
import { spaceHeatingKWhFor } from "../sim/yearReport";
import { useTariff } from "../sim/store";
import { tariffKey } from "../sim/tariff";
import { CONSUMPTION_CATEGORIES } from "./deviceCategories";
import { PieChart, type PieSlice } from "./PieChart";
import { usePeriodPieEnergy } from "./usePeriodPieEnergy";
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
