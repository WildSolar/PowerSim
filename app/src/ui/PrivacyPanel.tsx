import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { ANALYTICS_ENABLED, countingOff, setCountingOff } from "../analytics";
import { LEADERBOARD_ENABLED } from "../leaderboard/client";
import "./changelog.css";

const CONTACT = "admin@commune-zero.ch";

/** Imprint & privacy: who makes the game, and what it does with data — what stays in the browser,
 * the anonymous visit count (with a switch to turn it off), the leaderboard, feedback, and the
 * services the page relies on. Linked from the start screen and the game menu. */
export function PrivacyPanel({ onClose }: { onClose: () => void }) {
  const [off, setOff] = useState(countingOff());
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

  const mail = <a href={`mailto:${CONTACT}`}>{CONTACT}</a>;
  return (
    <div className="changelog" role="dialog" aria-label="Imprint and privacy">
      <header className="cl-head">
        <div>
          <div className="cl-kicker">Commune Zéro</div>
          <div className="cl-version">Imprint & privacy</div>
        </div>
        <button className="cl-close" onClick={onClose} aria-label="Close">
          <X size={18} strokeWidth={1.75} aria-hidden />
        </button>
      </header>
      <div className="cl-body">
        <div className="cl-page">
          <h1>Imprint</h1>
          <p className="cl-summary">
            Commune Zéro is made and run by Michael Wild, as a private, non-commercial project. It is free to play and carries no advertising.
          </p>
          <p className="cl-summary">Contact: {mail}</p>

          <h1 className="privacy-next">Privacy</h1>
          <p className="cl-summary">
            In short: no cookies, no tracking, no advertising. The game runs in your browser, and your games stay there. Visits are counted anonymously.
            Something about you leaves your browser only if you put a run on the leaderboard or send feedback. Who is responsible for the data described
            here: Michael Wild, {mail}.
          </p>

          <section className="cl-group">
            <h3>In your browser</h3>
            <p className="cl-summary">
              The game keeps your saves, your settings (sound, the layer dock), how far you are in the guide, which version's news you have seen and which
              leaderboard entries are yours in your browser&apos;s own storage — no cookies. None of it is sent anywhere; it is there so the game works as
              you left it. Clearing this site&apos;s data in your browser removes all of it, saves included.
            </p>
          </section>

          <section className="cl-group">
            <h3>Counting visits</h3>
            <p className="cl-summary">
              The published game counts visits and a few milestones — a game started (which town, which difficulty), the guide&apos;s chapters, a Year in
              Review reached, how a run ended, a crash — with GoatCounter, run by Martin Tournoij in Ireland on servers in Finland and Germany. GoatCounter
              stores nothing in your browser. To count a visit once, it holds your IP address with a random number in memory for at most eight hours, and
              never writes it down; what it keeps is anonymous totals: browser, operating system, screen width, language and rough location. We use it to see which towns are played and where players get stuck.
              {ANALYTICS_ENABLED ? "" : " (This copy of the game doesn't count.)"}
            </p>
            <label className="privacy-switch">
              <input
                type="checkbox"
                checked={off}
                onChange={(e) => {
                  setCountingOff(e.target.checked);
                  setOff(e.target.checked);
                }}
              />
              <span>Don&apos;t count my visits (remembered in this browser)</span>
            </label>
          </section>

          <section className="cl-group">
            <h3>The leaderboard</h3>
            <p className="cl-summary">
              Only if you put a finished run on the leaderboard: the name you choose, the town, the difficulty, the version and the run&apos;s emissions year
              by year. It is kept on the game&apos;s server at Cloudflare and shown to everyone who opens the leaderboard. To limit how often one connection
              can submit, your IP address is kept as a one-way hash for a day, then deleted. Entries stay on the leaderboard; write to {mail} to have yours
              removed.
              {LEADERBOARD_ENABLED ? "" : " (This copy of the game has no leaderboard.)"}
            </p>
          </section>

          <section className="cl-group">
            <h3>Feedback</h3>
            <p className="cl-summary">
              What you write, where you were in the game, your browser and screen size and — if you tick it — your game as a save go to the game&apos;s
              server at Cloudflare and on to the developer by e-mail, sent through Resend. It is read only to improve the game and never published. It is
              kept as long as it is useful for that; write to {mail} to have yours deleted sooner. The IP address is used only to limit how often one
              connection can send, as a one-way hash kept for a day.
            </p>
          </section>

          <section className="cl-group">
            <h3>The page itself and the map</h3>
            <p className="cl-summary">
              The game is served by GitHub Pages, and the map tiles come from swisstopo, the Federal Office of Topography. Like any web server, theirs see
              your IP address and browser when you load the page or the map, and may keep it in their logs for a short time for security and operation.
              The share buttons are plain links: nothing is loaded from those sites until you click one.
            </p>
          </section>

          <section className="cl-group">
            <h3>Abroad</h3>
            <p className="cl-summary">
              GitHub, Cloudflare and Resend are companies in the USA, and data reaching them may be processed there; they offer the safeguards Swiss data
              protection law asks for — the Swiss–US Data Privacy Framework or standard contractual clauses. GoatCounter&apos;s servers are in the EU.
            </p>
          </section>

          <section className="cl-group">
            <h3>Your rights</h3>
            <p className="cl-summary">
              You may ask what data about you is kept, and have it corrected or deleted: write to {mail}. You may also turn to the Federal Data Protection
              and Information Commissioner (FDPIC).
            </p>
            <p className="cl-summary">As of 27 October 2026.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
