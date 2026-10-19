/**
 * The player's inbox: letters (letters.ts, and the advisors', the projects' and the canton's), in
 * four groups — votes, requests, advisors and projects, and everything else. Only the first three
 * call for attention (a toast, the badge); the rest wait quietly under Letters. Items can be
 * written ahead of time — a letter dated a few days after the decision it answers — and only show
 * once the clock reaches them. What has been read is remembered for the session.
 */

import type { Bloc } from "../config/approval";
import { simClock } from "./engine";

import type { AdvisorId } from "./advisors";
export type LetterKind =
  | "welcome"
  | "reaction"
  | "campaign"
  | "mood"
  | "report" // residents' complaints, or an advisor's report (`advisor` set)
  | "request"
  | "followUp" // a request's outcome
  | "voteCalled"
  | "voteResult"
  | "election"
  | "warning" // approval low
  | "offer" // a firm offering its waste heat
  | "project" // the town's own projects: permits, court rulings, roof-contract answers
  | "notice" // from the administration: the canton's supervision, the green bond, a price shock
  | "announcement"; // news from town, for information

export type InboxGroup = "votes" | "requests" | "advisors" | "letters";

/** The inbox's tabs, in order. */
export const INBOX_GROUPS: InboxGroup[] = ["votes", "requests", "advisors", "letters"];

/** The groups that call for attention: a toast as a letter arrives, and the badge. */
export const NOTIFYING_GROUPS: ReadonlySet<InboxGroup> = new Set(["votes", "requests", "advisors"]);

export function letterGroup(l: Letter): InboxGroup {
  switch (l.kind) {
    case "voteCalled":
    case "voteResult":
    case "campaign":
    case "election":
    case "warning":
      return "votes";
    case "request":
      return "requests";
    case "offer":
    case "project":
    case "notice":
      return "advisors";
    case "report":
      return l.advisor ? "advisors" : "letters";
    default:
      return "letters";
  }
}

export interface Letter {
  id: string;
  atMs: number;
  kind: LetterKind;
  bloc: Bloc | null;
  /** Who signs, and how ("tenant, Badenerstrasse"); the role is empty for an organisation. */
  from: string;
  role: string;
  subject: string;
  paragraphs: string[];
  /** A place the letter is about, to show on the map — a building, when it is about one. */
  focus?: { lon: number; lat: number; egid?: string };
  /** Places a report ranks: each opens its planning tool there. */
  picks?: LetterPick[];
  /** An advisor's report (advisors.ts): the letter points to it in the Town hall. */
  advisor?: AdvisorId;
  requestId?: string;
}

export interface LetterPick {
  label: string;
  detail: string;
  lon: number;
  lat: number;
  /** A building it is about (its panel opens in the tool). */
  egid?: string;
  /** The planning tool it opens. */
  tool: "roofSolar" | "evCharging" | "districtHeat";
  /** District heating: the street segments to plan as an extension. */
  segments?: number[];
  /** EV charging: an on-street site, or a hub for vans and lorries. */
  charger?: "ac" | "hub";
  /** District heating: a factory's waste heat on offer (its candidate). */
  candidateId?: string;
}

class Inbox {
  private letters: Letter[] = [];
  private read = new Set<string>();
  private shownUpTo = -Infinity; // items at or before this are visible
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private readonly arrivalListeners = new Set<(item: Letter) => void>();
  private unsubscribeClock: (() => void) | null = null;

  init(): void {
    this.unsubscribeClock?.();
    this.letters = [];
    this.read = new Set();
    this.shownUpTo = simClock.getSimTimeMs();
    this.unsubscribeClock = simClock.subscribe(() => this.reveal(simClock.getSimTimeMs()));
    this.bump();
  }

  addLetter(letter: Letter): void {
    this.letters.push(letter);
    this.letters.sort((a, b) => a.atMs - b.atMs);
    this.revealIfDue(letter);
  }

  /** Letters that have arrived, newest first. */
  getLetters(nowMs: number): Letter[] {
    return this.letters.filter((l) => l.atMs <= nowMs).reverse();
  }

  getLetter(id: string): Letter | undefined {
    return this.letters.find((l) => l.id === id);
  }

  isRead(id: string): boolean {
    return this.read.has(id);
  }

  markRead(id: string): void {
    if (this.read.has(id)) return;
    this.read.add(id);
    this.bump();
  }

  /** Marks every letter that has arrived by `nowMs` as read (of one group, if given). */
  markAllRead(nowMs: number, group?: InboxGroup): void {
    for (const l of this.letters) if (l.atMs <= nowMs && (!group || letterGroup(l) === group)) this.read.add(l.id);
    this.bump();
  }

  /** Unread letters, by group. */
  unreadCount(nowMs: number): Record<InboxGroup, number> {
    const count: Record<InboxGroup, number> = { votes: 0, requests: 0, advisors: 0, letters: 0 };
    for (const l of this.letters) if (l.atMs <= nowMs && !this.read.has(l.id)) count[letterGroup(l)]++;
    return count;
  }

  /** Unread letters that call for attention (the badge). */
  unreadNotifying(nowMs: number): number {
    const c = this.unreadCount(nowMs);
    return c.votes + c.requests + c.advisors;
  }

  getVersion(): number {
    return this.version;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Called as each item arrives (for a toast). */
  onArrival(listener: (item: Letter) => void): () => void {
    this.arrivalListeners.add(listener);
    return () => this.arrivalListeners.delete(listener);
  }

  private revealIfDue(item: Letter): void {
    if (item.atMs <= this.shownUpTo) {
      this.arrivalListeners.forEach((l) => l(item));
      this.bump();
    }
  }

  private reveal(nowMs: number): void {
    if (nowMs <= this.shownUpTo) return;
    const arrived = this.letters.filter((i) => i.atMs > this.shownUpTo && i.atMs <= nowMs);
    this.shownUpTo = nowMs;
    if (arrived.length === 0) return;
    for (const item of arrived.sort((a, b) => a.atMs - b.atMs)) this.arrivalListeners.forEach((l) => l(item));
    this.bump();
  }

  private bump(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  // --- saving (saveGame.ts) ---

  snapshot() {
    return { letters: this.letters, read: this.read, shownUpTo: this.shownUpTo };
  }

  restore(s: ReturnType<Inbox["snapshot"]>): void {
    this.letters = s.letters;
    this.read = s.read;
    this.shownUpTo = s.shownUpTo;
    this.bump();
  }
}

export const inbox = new Inbox();
