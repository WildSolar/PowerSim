import { useSyncExternalStore } from "react";
import { approval } from "../sim/approval";
import { grid } from "../sim/grid";
import { monthRecords } from "../sim/monthRecords";
import { useSimDay } from "../sim/store";
import { chartNav } from "./chartNav";
import { CHART_GROUPS, CHARTS } from "./charts";
import { TimeChart } from "./TimeChart";
import "./charts.css";

const EMPTY: Record<string, string> = {
  transformer: "Nothing read yet: the stations are read after each winter and each summer.",
  overloaded: "Nothing read yet: the stations are read after each winter and each summer.",
  emissions: "Emissions are counted at the end of each year, in the Year in Review.",
  utility: "The utility's accounts are booked at the end of each year.",
};

/** The town hall's Charts tab: the list of charts on the left, the chosen one in the middle. */
export function ChartsTab() {
  const selection = useSyncExternalStore(
    (l) => chartNav.subscribe(l),
    () => chartNav.get(),
  );
  // Redrawn as the record grows: a month counted, a station read, approval moving.
  useSyncExternalStore(
    (l) => monthRecords.subscribe(l),
    () => monthRecords.getVersion(),
  );
  useSyncExternalStore(
    (l) => grid.subscribe(l),
    () => grid.getVersion(),
  );
  useSyncExternalStore(
    (l) => approval.subscribe(l),
    () => approval.getVersion(),
  );
  const now = useSimDay();

  const chart = CHARTS.find((c) => c.id === selection.id) ?? CHARTS[0];
  const options = chart.param?.options() ?? [];
  const param = chart.param ? (options.find((o) => o.value === selection.param)?.value ?? chart.param.defaultValue?.() ?? options[0]?.value ?? "") : null;
  const data = chart.data(param, now);

  return (
    <div className="charts-tab">
      <nav className="charts-list" aria-label="Charts">
        {CHART_GROUPS.map((g) => (
          <section key={g}>
            <h3>{g}</h3>
            {CHARTS.filter((c) => c.group === g).map((c) => (
              <button key={c.id} className={c.id === chart.id ? "active" : ""} aria-current={c.id === chart.id ? "true" : undefined} onClick={() => chartNav.select(c.id, c.id === chart.id ? param : null)}>
                {c.title}
              </button>
            ))}
          </section>
        ))}
      </nav>
      <section className="charts-main">
        <header className="charts-head">
          <div>
            <h2>{chart.title}</h2>
            <p>{chart.description}</p>
          </div>
          {chart.param && options.length > 0 && (
            <label className="charts-param">
              <span>{chart.param.label}</span>
              <select value={param ?? ""} onChange={(e) => chartNav.select(chart.id, e.target.value)}>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </header>
        <TimeChart data={data} emptyText={EMPTY[chart.id] ?? "Nothing recorded yet: each month is counted once it is over."} />
      </section>
    </div>
  );
}
