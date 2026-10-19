/**
 * Sharing a finished run: a line of text with a link to the game, sent through the browser's own
 * share sheet where there is one (phones, most desktop browsers), or through each platform's plain
 * share link. No platform's script is loaded and nothing is tracked: a link only opens the
 * platform's own page with the text filled in, and the player decides there.
 */

export const GAME_URL = "https://commune-zero.ch";

export interface ShareStory {
  municipality: string;
  difficulty: "easy" | "normal" | "hard";
  score: number;
  vsPar: number | null;
  netZeroYear: number | null;
  /** The cut in emissions per resident against the start, in the last year played (%). */
  cut: number | null;
  /** Voted out or recalled. */
  over: boolean;
  /** The place on the leaderboard, if it was submitted. */
  rank: { place: number; of: number } | null;
}

/** The line to share, without the link. */
export function shareText(s: ShareStory): string {
  const hard = s.difficulty === "hard" ? " on hard" : s.difficulty === "easy" ? " on easy" : "";
  const points = `${s.score.toLocaleString("en-GB")} points${s.vsPar !== null && s.vsPar > 0 ? `, ${s.vsPar.toLocaleString("en-GB")} above par` : ""}`;
  const rank = s.rank ? ` — #${s.rank.place} of ${s.rank.of} on the leaderboard` : "";
  if (s.over) return `I ran the energy department of ${s.municipality}${hard} in Commune Zéro until the voters had had enough: ${points}${rank}. Can you do better?`;
  if (s.netZeroYear !== null) return `I took ${s.municipality} to net zero by ${s.netZeroYear}${hard} in Commune Zéro: ${points}${rank}. Can you beat it?`;
  return `I cut ${s.municipality}'s emissions per resident by ${s.cut ?? 0}% by 2050${hard} in Commune Zéro: ${points}${rank}. Can you get it to net zero?`;
}

/** An invitation to play — from the start screen, or (naming the town) from a running game. */
export function inviteText(municipality: string | null): string {
  return municipality
    ? `I'm running the energy department of ${municipality} in Commune Zéro — a free browser game about taking a real Swiss town to net zero by 2050. Give it a try!`
    : "Commune Zéro: a free browser game about taking a real Swiss town to net zero by 2050 — its buildings, its grid, its voters. Give it a try!";
}

/** Whether the browser has its own share sheet. */
export function canShareNatively(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

export async function shareNatively(text: string): Promise<boolean> {
  try {
    await navigator.share({ title: "Commune Zéro", text, url: GAME_URL });
    return true;
  } catch {
    return false; // dismissed, or not allowed
  }
}

const enc = encodeURIComponent;

/** Each platform's own share page, with the text and the link filled in. */
export function shareLinks(text: string): { id: string; label: string; href: string }[] {
  const withUrl = `${text} ${GAME_URL}`;
  return [
    { id: "whatsapp", label: "WhatsApp", href: `https://wa.me/?text=${enc(withUrl)}` },
    { id: "x", label: "X", href: `https://x.com/intent/post?text=${enc(text)}&url=${enc(GAME_URL)}` },
    { id: "bluesky", label: "Bluesky", href: `https://bsky.app/intent/compose?text=${enc(withUrl)}` },
    { id: "facebook", label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${enc(GAME_URL)}` },
    { id: "linkedin", label: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(GAME_URL)}` },
    { id: "reddit", label: "Reddit", href: `https://www.reddit.com/submit?url=${enc(GAME_URL)}&title=${enc(text)}` },
    { id: "email", label: "E-mail", href: `mailto:?subject=${enc("Commune Zéro")}&body=${enc(withUrl)}` },
  ];
}
