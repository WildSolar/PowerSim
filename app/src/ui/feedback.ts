/**
 * Feedback and crash reports: the report's text, and the save that goes with it. Sent straight to
 * the game's server (the leaderboard's, leaderboard/ — it keeps them and e-mails the admin) when the
 * build has one; otherwise, or if sending fails, the player copies the report to an e-mail. The
 * address comes from the build (VITE_FEEDBACK_EMAIL, set in the deploy workflow from the repository
 * variable FEEDBACK_EMAIL). Players with a GitHub account can open an issue instead (public, and
 * without the save).
 */

import { VERSION_LABEL } from "../changelog";
import { approval } from "../sim/approval";
import { formatDate } from "../sim/calendar";
import type { Crash } from "../sim/crash";
import { simClock } from "../sim/engine";
import { captureSave, GAME_VERSION, saveToString, type RunInfo } from "../sim/saveGame";
import { downloadText, saveFileName } from "./saveFiles";
import { LEADERBOARD_ENABLED, LEADERBOARD_URL } from "../leaderboard/client";
import type { FeedbackSubmission } from "../leaderboard/rules";

export const FEEDBACK_EMAIL: string = (import.meta.env.VITE_FEEDBACK_EMAIL as string | undefined)?.trim() ?? "";

/** Whether feedback can be sent from the game (the build knows the server). */
export const FEEDBACK_SENDABLE = LEADERBOARD_ENABLED;

/** Where a new GitHub issue is opened. */
export const ISSUES_URL = "https://github.com/WildSolar/PowerSim/issues/new";

export const FEEDBACK_KINDS = ["Something broke", "Something was confusing", "An idea", "The balance (too easy, too hard)", "Something else"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** The report as plain text: what the player wrote, and where they were. Kept short enough for an
 * email link (some mail apps cut them off around 2000 characters). */
export function reportText(opts: { kind: FeedbackKind; message: string; run: RunInfo | null; crash?: Crash | null; saveFile?: string | null }): string {
  const t = simClock.getSimTimeMs();
  const lines = [
    `Kind: ${opts.kind}`,
    "",
    opts.message.trim() || "(no message)",
    "",
    "---",
    `Version: ${VERSION_LABEL} (build ${GAME_VERSION})`,
    opts.run ? `Municipality: ${opts.run.municipality}, ${opts.run.difficulty}${opts.run.transparency ? ", transparency" : ""}` : "Municipality: (none)",
    `In-game date: ${formatDate(t)}`,
    `Approval: ${Math.round(approval.getApproval())}%`,
    `Browser: ${navigator.userAgent}`,
    `Screen: ${window.innerWidth}×${window.innerHeight}`,
  ];
  if (opts.saveFile) lines.push(`Save attached: ${opts.saveFile}`);
  if (opts.crash) {
    lines.push("", `Error (${opts.crash.where}): ${opts.crash.message}`, opts.crash.stack.split("\n").slice(0, 6).join("\n").slice(0, 600));
  }
  return lines.join("\n");
}

/** The run as a save file, downloaded; returns the file's name (null if there is no run). */
export async function downloadSave(run: RunInfo | null, label: string): Promise<string | null> {
  if (!run) return null;
  const { bytes } = await captureSave(run, label);
  const name = saveFileName(run.municipality, simClock.getSimTimeMs());
  downloadText(name, saveToString(bytes));
  return name;
}

/** Sends the feedback, with the run as a save string if asked; returns its number. */
export async function sendFeedback(opts: { kind: FeedbackKind; message: string; run: RunInfo | null; crash: Crash | null; attachSave: boolean }): Promise<{ id: number; saveError: string | null }> {
  let save: string | null = null;
  let saveError: string | null = null;
  if (opts.attachSave && opts.run) {
    try {
      save = saveToString((await captureSave(opts.run, "Feedback")).bytes);
    } catch (e) {
      saveError = (e as Error).message;
    }
  }
  const body: FeedbackSubmission = {
    kind: opts.kind,
    message: opts.message.trim(),
    details: reportText({ kind: opts.kind, message: "", run: opts.run, crash: opts.crash }).split("---\n").slice(1).join("---\n"),
    version: VERSION_LABEL,
    build: GAME_VERSION,
    crash: opts.crash !== null,
    save,
  };
  const response = await fetch(`${LEADERBOARD_URL}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const answer = (await response.json().catch(() => null)) as { id?: number; error?: string } | null;
  if (!response.ok || !answer?.id) throw new Error(answer?.error ?? `The server didn't answer (${response.status}).`);
  return { id: answer.id, saveError };
}

/** A new GitHub issue with the report filled in (the save can't go along). */
export function issueUrl(kind: FeedbackKind, report: string): string {
  const title = `${kind}: `;
  const body = `${report.slice(0, 5000)}\n\n(Sent from the game's feedback form.)`;
  return `${ISSUES_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

/** Opens the player's mail app with the report. */
export function openEmail(subject: string, body: string): void {
  if (!FEEDBACK_EMAIL) return;
  const href = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.slice(0, 1800))}`;
  window.location.href = href;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
