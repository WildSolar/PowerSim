import { Check, Copy, X } from "lucide-react";
import { useState } from "react";
import { crashes, type Crash } from "../sim/crash";
import { copyText, downloadSave, FEEDBACK_EMAIL, FEEDBACK_KINDS, openEmail, reportText, type FeedbackKind } from "./feedback";
import { usePauseWhileOpen } from "./usePauseWhileOpen";
import "./feedback.css";

/** Pauses while open — but not over a crash (the clock is stopped already, and the hook needs the game). */
function PauseWhileOpen() {
  usePauseWhileOpen();
  return null;
}

/** Tell the person running the playtest what happened: a few words, the save, where you were. */
export function FeedbackDialog({ onClose, crash = null, pause = true }: { onClose: () => void; crash?: Crash | null; pause?: boolean }) {
  const [kind, setKind] = useState<FeedbackKind>(crash ? "Something broke" : FEEDBACK_KINDS[0]);
  const [message, setMessage] = useState("");
  const [attachSave, setAttachSave] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ report: string; saveFile: string | null; saveError: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  const send = async () => {
    setBusy(true);
    let saveFile: string | null = null;
    let saveError: string | null = null;
    if (attachSave) {
      try {
        saveFile = await downloadSave(crashes.getRun(), "Feedback");
      } catch (e) {
        saveError = (e as Error).message;
      }
    }
    const report = reportText({ kind, message, run: crashes.getRun(), crash, saveFile });
    setSent({ report, saveFile, saveError });
    setBusy(false);
    if (FEEDBACK_EMAIL) openEmail(`Commune Zéro: ${kind}`, report + (saveFile ? `\n\nPlease attach the save file from your downloads: ${saveFile}` : ""));
  };

  return (
    <div className="fb-layer">
      {pause && <PauseWhileOpen />}
      <div className="fb-scrim" onClick={onClose} />
      <div className="fb-dialog" role="dialog" aria-labelledby="fb-title">
        <header className="fb-head">
          <h2 id="fb-title">{crash ? "Report the problem" : "Send feedback"}</h2>
          <button className="fb-close" onClick={onClose} aria-label="Close">
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </header>

        {!sent ? (
          <>
            <p className="fb-note">
              Thanks for playing. Anything helps: what broke, what was unclear, what felt too easy or too hard. Your game version, the in-game date and your
              browser go along automatically.
            </p>
            <label className="fb-label" htmlFor="fb-kind">
              What is it about?
            </label>
            <select id="fb-kind" className="fb-input" value={kind} onChange={(e) => setKind(e.target.value as FeedbackKind)}>
              {FEEDBACK_KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            <label className="fb-label" htmlFor="fb-message">
              What happened, or what do you think?
            </label>
            <textarea
              id="fb-message"
              className="fb-input fb-text"
              rows={6}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={crash ? "What were you doing just before it happened?" : "Tell us in your own words…"}
            />
            <label className="fb-check">
              <input type="checkbox" checked={attachSave} onChange={(e) => setAttachSave(e.target.checked)} />
              <span>Attach my game (downloads a save file to add to the email) — it lets us see exactly what you saw</span>
            </label>
            <div className="fb-actions">
              <button className="fb-primary" disabled={busy} onClick={send}>
                {busy ? "Preparing…" : FEEDBACK_EMAIL ? "Write the email" : "Prepare the report"}
              </button>
              <button className="fb-secondary" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            {FEEDBACK_EMAIL ? (
              <p className="fb-note">
                Your mail app should open with the report.
                {sent.saveFile && (
                  <>
                    {" "}
                    Please attach <strong>{sent.saveFile}</strong> from your downloads folder before sending.
                  </>
                )}{" "}
                If no mail app opened, copy the report below and send it to <strong>{FEEDBACK_EMAIL}</strong>.
              </p>
            ) : (
              <p className="fb-note">
                Copy the report below and send it to whoever invited you to play
                {sent.saveFile ? (
                  <>
                    , with <strong>{sent.saveFile}</strong> from your downloads folder attached
                  </>
                ) : null}
                .
              </p>
            )}
            {sent.saveError && <p className="fb-note fb-bad">The save couldn't be made ({sent.saveError}); the report alone still helps.</p>}
            <textarea className="fb-input fb-report" readOnly rows={9} value={sent.report} onFocus={(e) => e.currentTarget.select()} aria-label="The report" />
            <div className="fb-actions">
              <button
                className="fb-secondary"
                onClick={async () => {
                  setCopied(await copyText(sent.report));
                }}
              >
                {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />} {copied ? "Copied" : "Copy the report"}
              </button>
              <button className="fb-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
