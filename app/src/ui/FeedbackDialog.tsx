import { Check, Copy, ExternalLink, X } from "lucide-react";
import { track } from "../analytics";
import { useEffect, useState } from "react";
import { crashes, type Crash } from "../sim/crash";
import { copyText, downloadSave, FEEDBACK_EMAIL, FEEDBACK_KINDS, FEEDBACK_SENDABLE, issueUrl, openEmail, reportText, sendFeedback, type FeedbackKind } from "./feedback";
import { usePauseWhileOpen } from "./usePauseWhileOpen";
import "./feedback.css";

/** Pauses while open — but not over a crash (the clock is stopped already, and the hook needs the game). */
function PauseWhileOpen() {
  usePauseWhileOpen();
  return null;
}

type Outcome =
  | { kind: "sent"; id: number; saveError: string | null }
  // Not sent (no server, or it failed): the report to copy into an e-mail.
  | { kind: "manual"; report: string; saveFile: string | null; saveError: string | null; reason: string | null };

/** Tell whoever runs the game what happened: a few words, the save, where you were — sent straight
 * from here when the game has its server, else by e-mail. */
export function FeedbackDialog({
  onClose,
  crash = null,
  pause = true,
  withGame = true,
}: {
  onClose: () => void;
  crash?: Crash | null;
  pause?: boolean;
  /** Whether there is a game to attach (not from the start screen, where the last one may linger). */
  withGame?: boolean;
}) {
  const [kind, setKind] = useState<FeedbackKind>(crash ? "Something broke" : FEEDBACK_KINDS[0]);
  const [message, setMessage] = useState("");
  const [attachSave, setAttachSave] = useState(true);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => track(crash ? "feedback/crash" : "feedback/open", "Feedback form opened"), [crash]);

  const run = withGame ? crashes.getRun() : null;
  const canSend = message.trim() !== "" || crash !== null || (attachSave && run !== null);

  /** The e-mail route: the save downloaded as a file to attach, the report to paste. */
  const manual = async (reason: string | null) => {
    let saveFile: string | null = null;
    let saveError: string | null = null;
    if (attachSave) {
      try {
        saveFile = await downloadSave(run, "Feedback");
      } catch (e) {
        saveError = (e as Error).message;
      }
    }
    const report = reportText({ kind, message, run, crash, saveFile });
    setOutcome({ kind: "manual", report, saveFile, saveError, reason });
    if (FEEDBACK_EMAIL && reason === null) openEmail(`Commune Zéro: ${kind}`, report + (saveFile ? `\n\nPlease attach the save file from your downloads: ${saveFile}` : ""));
  };

  const send = async () => {
    setBusy(true);
    try {
      if (FEEDBACK_SENDABLE) {
        try {
          const { id, saveError } = await sendFeedback({ kind, message, run, crash, attachSave });
          setOutcome({ kind: "sent", id, saveError });
          track("feedback/sent", "Feedback sent");
        } catch (e) {
          await manual((e as Error).message);
        }
      } else {
        await manual(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const github = (
    <p className="fb-note fb-github">
      Have a GitHub account? You can also{" "}
      <a className="fb-link" href={issueUrl(kind, reportText({ kind, message, run, crash }))} target="_blank" rel="noopener noreferrer">
        open an issue on GitHub <ExternalLink size={12} aria-hidden />
      </a>{" "}
      — it's public there, and can't take your game along.
    </p>
  );

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

        {!outcome ? (
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
            {run && (
              <label className="fb-check">
                <input type="checkbox" checked={attachSave} onChange={(e) => setAttachSave(e.target.checked)} />
                <span>
                  Attach my game — it lets us see exactly what you saw
                  {FEEDBACK_SENDABLE ? "" : " (downloads a save file to add to the email)"}
                </span>
              </label>
            )}
            <div className="fb-actions">
              <button className="fb-primary" disabled={busy || !canSend} onClick={send}>
                {busy ? (FEEDBACK_SENDABLE ? "Sending…" : "Preparing…") : FEEDBACK_SENDABLE ? "Send" : FEEDBACK_EMAIL ? "Write the email" : "Prepare the report"}
              </button>
              <button className="fb-secondary" onClick={onClose}>
                Cancel
              </button>
            </div>
            {github}
          </>
        ) : outcome.kind === "sent" ? (
          <>
            <p className="fb-note">
              <strong>Sent — thank you!</strong> It arrived as report #{outcome.id}
              {attachSave && !outcome.saveError && run ? ", with your game" : ""}. We read every one.
            </p>
            {outcome.saveError && <p className="fb-note fb-bad">Your game couldn't be attached ({outcome.saveError}); the report alone still helps.</p>}
            <div className="fb-actions">
              <button className="fb-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            {outcome.reason && <p className="fb-note fb-bad">It couldn't be sent from here ({outcome.reason}). Please send it by e-mail instead:</p>}
            {FEEDBACK_EMAIL ? (
              <p className="fb-note">
                {outcome.reason ? "" : "Your mail app should open with the report. "}
                {outcome.saveFile && (
                  <>
                    Please attach <strong>{outcome.saveFile}</strong> from your downloads folder.{" "}
                  </>
                )}
                {outcome.reason ? "Copy" : "If no mail app opened, copy"} the report below and send it to <strong>{FEEDBACK_EMAIL}</strong>.
              </p>
            ) : (
              <p className="fb-note">
                Copy the report below and send it to whoever invited you to play
                {outcome.saveFile ? (
                  <>
                    , with <strong>{outcome.saveFile}</strong> from your downloads folder attached
                  </>
                ) : null}
                .
              </p>
            )}
            {outcome.saveError && <p className="fb-note fb-bad">The save couldn't be made ({outcome.saveError}); the report alone still helps.</p>}
            <textarea className="fb-input fb-report" readOnly rows={9} value={outcome.report} onFocus={(e) => e.currentTarget.select()} aria-label="The report" />
            <div className="fb-actions">
              <button
                className="fb-secondary"
                onClick={async () => {
                  setCopied(await copyText(outcome.report));
                }}
              >
                {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />} {copied ? "Copied" : "Copy the report"}
              </button>
              <button className="fb-primary" onClick={onClose}>
                Done
              </button>
            </div>
            {github}
          </>
        )}
      </div>
    </div>
  );
}
