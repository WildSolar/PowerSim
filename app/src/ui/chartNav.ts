/**
 * Which chart (or At a glance) the Statistics tab shows (ChartsTab.tsx), and the way to it from elsewhere: a PlotLink
 * next to a transformer, a network or an account asks for its chart, and App opens the town hall
 * on the Statistics tab.
 */

export interface ChartSelection {
  id: string;
  /** The chart's parameter (a transformer area), if it has one. */
  param: string | null;
}

class ChartNav {
  private selection: ChartSelection = { id: "glance", param: null };
  private readonly listeners = new Set<() => void>();
  private opener: (() => void) | null = null;

  get(): ChartSelection {
    return this.selection;
  }

  select(id: string, param: string | null = null): void {
    this.selection = { id, param };
    this.listeners.forEach((l) => l());
  }

  /** Shows a chart: selects it and opens the town hall's Statistics tab. */
  open(id: string, param: string | null = null): void {
    this.select(id, param);
    this.opener?.();
  }

  /** App: how to open the Statistics tab. */
  setOpener(opener: (() => void) | null): void {
    this.opener = opener;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const chartNav = new ChartNav();
