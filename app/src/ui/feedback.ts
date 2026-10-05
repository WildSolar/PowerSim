/**
 * Feedback and crash reports: the report's text, the save that goes with it, and the email that
 * carries them. The address comes from the build (VITE_FEEDBACK_EMAIL, set in the deploy workflow
 * from the repository variable FEEDBACK_EMAIL); without one, the player copies the report instead.
 * A save is far too big for an email link, so it's downloaded as a file to attach.
 */

import { VERSION_LABEL } from "../changelog";
import { approval } from "../sim/approval";
import { formatDate } from "../sim/calendar";
import type { Crash } from "../sim/crash";
import { simClock } from "../sim/engine";
import { captureSave, GAME_VERSION, saveToString, type RunInfo } from "../sim/saveGame";
import { downloadText, saveFileName } from "./saveFiles";

export const FEEDBACK_EMAIL: string = (import.meta.env.VITE_FEEDBACK_EMAIL as string | undefined)?.trim() ?? "";

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
