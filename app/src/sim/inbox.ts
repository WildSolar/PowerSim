/**
 * The player's inbox: letters (letters.ts) and the monthly local paper (newspaper.ts). Items can be
 * written ahead of time — a letter dated a few days after the decision it answers — and only show
 * once the clock reaches them. What has been read is remembered for the session.
 */

import type { Bloc } from "../config/approval";
import { simClock } from "./engine";

export type LetterKind = "welcome" | "reaction" | "campaign" | "mood" | "report" | "request" | "followUp" | "voteResult";

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
  requestId?: string;
}

export interface NewsStory {
  headline: string;
  body: string;
}

export interface Edition {
  id: string;
  atMs: number;
  /** The month it reports on (year * 12 + month). */
  month: number;
  title: string; // the paper's name
  dateLabel: string; // "October 2026"
  lead: NewsStory;
  stories: NewsStory[];
  editorial: string;
}

class Inbox {
  private letters: Letter[] = [];
  private editions: Edition[] = [];
  private read = new Set<string>();
  private shownUpTo = -Infinity; // items at or before this are visible
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private readonly arrivalListeners = new Set<(item: Letter | Edition) => void>();
  private unsubscribeClock: (() => void) | null = null;

  init(): void {
    this.unsubscribeClock?.();
    this.letters = [];
    this.editions = [];
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

  addEdition(edition: Edition): void {
    this.editions.push(edition);
    this.editions.sort((a, b) => a.atMs - b.atMs);
    this.revealIfDue(edition);
  }

  /** Letters that have arrived, newest first. */
  getLetters(nowMs: number): Letter[] {
    return this.letters.filter((l) => l.atMs <= nowMs).reverse();
  }

  getLetter(id: string): Letter | undefined {
    return this.letters.find((l) => l.id === id);
  }

  /** Editions published so far, newest first. */
  getEditions(nowMs: number): Edition[] {
    return this.editions.filter((e) => e.atMs <= nowMs).reverse();
  }

  isRead(id: string): boolean {
    return this.read.has(id);
  }

  markRead(id: string): void {
    if (this.read.has(id)) return;
    this.read.add(id);
    this.bump();
  }

  /** Marks every letter and edition that has arrived by `nowMs` as read. */
  markAllRead(nowMs: number): void {
    for (const item of [...this.letters, ...this.editions]) if (item.atMs <= nowMs) this.read.add(item.id);
    this.bump();
  }

  unreadCount(nowMs: number): { letters: number; editions: number } {
    return {
      letters: this.letters.filter((l) => l.atMs <= nowMs && !this.read.has(l.id)).length,
      editions: this.editions.filter((e) => e.atMs <= nowMs && !this.read.has(e.id)).length,
    };
  }

  getVersion(): number {
    return this.version;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Called as each item arrives (for a toast). */
  onArrival(listener: (item: Letter | Edition) => void): () => void {
    this.arrivalListeners.add(listener);
    return () => this.arrivalListeners.delete(listener);
  }

  private revealIfDue(item: Letter | Edition): void {
    if (item.atMs <= this.shownUpTo) {
      this.arrivalListeners.forEach((l) => l(item));
      this.bump();
    }
  }

  private reveal(nowMs: number): void {
    if (nowMs <= this.shownUpTo) return;
    const arrived = [...this.letters, ...this.editions].filter((i) => i.atMs > this.shownUpTo && i.atMs <= nowMs);
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
    return { letters: this.letters, editions: this.editions, read: this.read, shownUpTo: this.shownUpTo };
  }

  restore(s: ReturnType<Inbox["snapshot"]>): void {
    this.letters = s.letters;
    this.editions = s.editions;
    this.read = s.read;
    this.shownUpTo = s.shownUpTo;
    this.bump();
  }
}

export const inbox = new Inbox();
