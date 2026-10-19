import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { loadMunicipalityIndex } from "../data/loadDataset";
import { fetchBoard, fetchBoards, myEntryIds } from "../leaderboard/client";
import { boardId, DIFFICULTIES, type BoardKey, type BoardSummary, type LeaderboardDifficulty, type LeaderboardEntry } from "../leaderboard/rules";
import "./changelog.css";
import "./leaderboard.css";

const DIFFICULTY_LABEL: Record<LeaderboardDifficulty, string> = { easy: "Easy", normal: "Normal", hard: "Hard" };

function dateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** The leaderboard: one board at a time — a town, a difficulty, a starting year and a version —
 * its best runs, highest first, and this browser's own marked. */
export function LeaderboardPanel({ initial, onClose }: { initial: BoardKey | null; onClose: () => void }) {
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [board, setBoard] = useState<BoardKey | null>(initial);
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mine = useMemo(() => myEntryIds(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  useEffect(() => {
    fetchBoards()
      .then((r) => {
        setBoards(r.boards);
        // Opened from the start screen: the newest version's board on Normal with the most runs.
        const newest = r.boards[0]?.version;
        const pool = r.boards.filter((x) => x.version === newest);
        const first = [...pool].sort((x, y) => Number(y.difficulty === "normal") - Number(x.difficulty === "normal") || y.entries - x.entries)[0];
        setBoard((b) => b ?? (first ? { version: first.version, slug: first.slug, difficulty: first.difficulty, startYear: first.startYear } : null));
      })
      .catch((e: Error) => setError(e.message));
    loadMunicipalityIndex()
      .then((index) => setNames(new Map(index.map((m) => [m.slug, m.name]))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!board) return;
    setEntries(null);
    fetchBoard(board)
      .then((r) => setEntries(r.entries))
      .catch((e: Error) => setError(e.message));
  }, [board]);

  // The choices on offer: every board with entries, and the one asked for (it may have none yet).
  const all = useMemo(() => {
    const list = [...(boards ?? [])];
    if (initial && !list.some((b) => boardId(b) === boardId(initial))) list.push({ ...initial, entries: 0 });
    return list;
  }, [boards, initial]);
  const versions = [...new Set(all.map((b) => b.version))].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const inVersion = all.filter((b) => b.version === board?.version);
  const towns = [...new Set(inVersion.map((b) => b.slug))].sort((a, b) => (names.get(a) ?? a).localeCompare(names.get(b) ?? b));
  const inTown = inVersion.filter((b) => b.slug === board?.slug);
  const difficulties = DIFFICULTIES.filter((d) => inTown.some((b) => b.difficulty === d));
  const years = [...new Set(inTown.filter((b) => b.difficulty === board?.difficulty).map((b) => b.startYear))].sort((a, b) => b - a);

  // Changing one choice keeps the ones before it (version, town, difficulty, year), and the ones
  // after it where a board has them — else the first board that fits.
  const pick = (patch: Partial<BoardKey>) => {
    if (!board) return;
    const wanted: BoardKey = { ...board, ...patch };
    const order: (keyof BoardKey)[] = ["version", "slug", "difficulty", "startYear"];
    const changed = order.findIndex((k) => k in patch);
    for (let n = order.length; n > changed; n--) {
      const keys = order.slice(0, n);
      const found = all.find((b) => keys.every((k) => b[k] === wanted[k]));
      if (found) {
        setBoard({ version: found.version, slug: found.slug, difficulty: found.difficulty, startYear: found.startYear });
        return;
      }
    }
  };

  return (
    <div className="changelog leaderboard" role="dialog" aria-label="Leaderboard">
      <header className="cl-head">
        <div>
          <div className="cl-kicker">Commune Zéro</div>
          <div className="cl-version">Leaderboard</div>
        </div>
        <button className="cl-close" onClick={onClose} aria-label="Close">
          <X size={18} strokeWidth={1.75} aria-hidden />
        </button>
      </header>
      <div className="cl-body">
        <div className="cl-page">
          <h1>Leaderboard</h1>
          <p className="cl-summary">
            Runs that reached 2050, or handed over early at net zero, by their score. A score only compares within one town, difficulty and starting year,
            and within one version of the game: each is a board of its own.
          </p>

          {board && (
            <div className="lb-filters">
              <label>
                <span>Town</span>
                <select value={board.slug} onChange={(e) => pick({ slug: e.target.value })}>
                  {towns.map((s) => (
                    <option key={s} value={s}>
                      {names.get(s) ?? s}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Difficulty</span>
                <select value={board.difficulty} onChange={(e) => pick({ difficulty: e.target.value as LeaderboardDifficulty })}>
                  {difficulties.map((d) => (
                    <option key={d} value={d}>
                      {DIFFICULTY_LABEL[d]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Started</span>
                <select value={board.startYear} onChange={(e) => pick({ startYear: Number(e.target.value) })}>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Version</span>
                <select value={board.version} onChange={(e) => pick({ version: e.target.value })}>
                  {versions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {error ? (
            <p className="lb-empty">{error}</p>
          ) : boards === null ? (
            <p className="lb-empty">Loading…</p>
          ) : !board ? (
            <p className="lb-empty">No runs on the leaderboard yet. Finish one and be the first.</p>
          ) : entries === null ? (
            <p className="lb-empty">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="lb-empty">No runs on this board yet.</p>
          ) : (
            <table className="lb-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Score</th>
                  <th>Against par</th>
                  <th>Net zero</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => {
                  const vsPar = e.par === null ? null : Math.round(e.score) - Math.round(e.par);
                  return (
                    <tr key={e.id} className={mine.has(e.id) ? "mine" : ""}>
                      <td>{i + 1}</td>
                      <td className="lb-name">{e.name}</td>
                      <td>{Math.round(e.score)}</td>
                      <td className={vsPar === null ? "" : vsPar >= 0 ? "good" : "bad"}>{vsPar === null ? "—" : `${vsPar >= 0 ? "+" : "−"}${Math.abs(vsPar)}`}</td>
                      <td>
                        {e.netZeroYear ?? "—"}
                        {e.finishedYear !== null && <span className="lb-sub"> · handed over {e.finishedYear}</span>}
                      </td>
                      <td>{dateLabel(e.submittedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <p className="lb-disclaimer">
            The leaderboard isn't moderated: every name is chosen by the player who submitted it. Names are filtered for the worst words, but not checked
            by anyone. Scores are checked for whether they add up, not replayed.
          </p>
        </div>
      </div>
    </div>
  );
}
