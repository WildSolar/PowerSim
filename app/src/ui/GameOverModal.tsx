import { useSyncExternalStore } from "react";
import { approval } from "../sim/approval";
import { formatDate } from "../sim/calendar";
import "./gameOver.css";

/** Shown when approval has ended the game. Everything is frozen behind it; the only way on is back to
 * the main menu (there is no saving yet, so that is a fresh start). */
export function GameOverModal() {
  useSyncExternalStore(
    (listener) => approval.subscribe(listener),
    () => approval.getVersion(),
  );
  const over = approval.getGameOver();
  if (!over) return null;

  const history = approval.getHistory();
  const peak = Math.max(...history.map((p) => p.approval));

  return (
    <div className="gameover-backdrop">
      <div className="gameover-card">
        <h2>{over.headline}</h2>
        <p className="gameover-date">{formatDate(over.atMs)}</p>
        <p>{over.text}</p>
        <p className="gameover-stats">
          Approval peaked at {Math.round(peak)}% and stood at {Math.round(approval.getApproval())}% at the end.
        </p>
        <button onClick={() => window.location.reload()}>Back to the main menu</button>
      </div>
    </div>
  );
}
