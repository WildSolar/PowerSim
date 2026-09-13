/**
 * Holds which completed calendar year (if any) should have its year-end report
 * card showing right now — set by yearEndWatcher.ts the instant it pauses the
 * clock at a year boundary, cleared when the player dismisses the card.
 * Mirrors tariffStore.ts's singleton+subscribe shape so both the watcher (a
 * plain module, not a component) and App.tsx (via useReportCardYear in
 * store.ts) can share it without threading it through props.
 */

class ReportCardStore {
  private pendingYear: number | null = null;
  private readonly listeners = new Set<() => void>();

  get(): number | null {
    return this.pendingYear;
  }

  show(year: number): void {
    this.pendingYear = year;
    this.listeners.forEach((listener) => listener());
  }

  dismiss(): void {
    this.pendingYear = null;
    this.listeners.forEach((listener) => listener());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const reportCardStore = new ReportCardStore();
