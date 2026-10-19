/**
 * Telling the admin that feedback came in: a short plain-text e-mail through Resend (resend.com),
 * from an address on the game's domain (verified there with Resend's DNS records). Without an API
 * key, nothing is sent — the feedback is kept all the same, on the admin page.
 */

import type { FeedbackItem } from "../../app/src/leaderboard/rules";

export interface MailConfig {
  RESEND_API_KEY?: string;
  /** Where it goes ("admin@commune-zero.ch"). */
  FEEDBACK_TO?: string;
  /** Who it's from ("Commune Zéro <feedback@commune-zero.ch>"): a domain verified with Resend. */
  FEEDBACK_FROM?: string;
}

export type SendMail = (subject: string, text: string) => Promise<void>;

export function resendMailer(config: MailConfig): SendMail | null {
  const { RESEND_API_KEY: key, FEEDBACK_TO: to, FEEDBACK_FROM: from } = config;
  if (!key || !to || !from) return null;
  return async (subject, text) => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    if (!response.ok) console.log(`Resend: ${response.status} ${await response.text().catch(() => "")}`);
  };
}

/** The e-mail about one feedback item. */
export function feedbackMail(item: FeedbackItem, adminUrl: string): { subject: string; text: string } {
  const firstLine = item.message.trim().split("\n")[0].slice(0, 70);
  return {
    subject: `Commune Zéro feedback #${item.id}: ${item.crash ? "crash — " : ""}${item.kind}${firstLine ? ` — ${firstLine}` : ""}`,
    text: [
      `${item.kind}${item.crash ? " (from the crash screen)" : ""}`,
      "",
      item.message.trim() || "(no message)",
      "",
      "---",
      item.details,
      "",
      item.hasSave ? "The player's game is attached: download it on the admin page." : "No game attached.",
      `Admin page: ${adminUrl}`,
    ].join("\n"),
  };
}
