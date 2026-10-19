import { ChartLine } from "lucide-react";
import "./charts.css";
import { chartNav } from "./chartNav";

/** A small grey chart icon: opens the town hall's Statistics tab on the chart about this. */
export function PlotLink({ chart, param = null, title = "Show over time" }: { chart: string; param?: string | null; title?: string }) {
  return (
    <button
      type="button"
      className="plot-link"
      title={`${title} (town hall · Statistics)`}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        chartNav.open(chart, param);
      }}
    >
      <ChartLine size={14} strokeWidth={1.75} aria-hidden />
    </button>
  );
}
