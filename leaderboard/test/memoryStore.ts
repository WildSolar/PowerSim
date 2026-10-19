/** The leaderboard's Store kept in memory — for the tests (run.ts) and the local server (devServer.ts). */

import type { FeedbackItem } from "../../app/src/leaderboard/rules";
import type { Blobs, NewEntry, NewFeedback, Store } from "../src/store";

export class MemoryBlobs implements Blobs {
  items = new Map<string, string>();
  async put(key: string, text: string) {
    this.items.set(key, text);
  }
  async get(key: string) {
    return this.items.get(key) ?? null;
  }
  async delete(key: string) {
    this.items.delete(key);
  }
}

export class MemoryStore implements Store {
  entries: (NewEntry & { id: number })[] = [];
  subs: { ipHash: string; at: number }[] = [];
  async findByRun(runId: string) {
    return this.entries.find((e) => e.runId === runId)?.id ?? null;
  }
  async insert(e: NewEntry) {
    const id = this.entries.length + 1;
    this.entries.push({ ...e, id });
    return id;
  }
  async rank(board: string, score: number, at: number) {
    return this.entries.filter((e) => e.board === board && (e.score > score || (e.score === score && e.submittedAt < at))).length + 1;
  }
  async count(board: string) {
    return this.entries.filter((e) => e.board === board).length;
  }
  async top(board: string, limit: number) {
    return this.entries
      .filter((e) => e.board === board)
      .sort((a, b) => b.score - a.score || a.submittedAt - b.submittedAt)
      .slice(0, limit)
      .map((e) => ({ id: e.id, name: e.name, score: e.score, par: e.par, netZeroYear: e.netZeroYear, finishedYear: e.finishedYear, submittedAt: e.submittedAt }));
  }
  async boards() {
    const map = new Map<string, NewEntry & { n: number }>();
    for (const e of this.entries) map.set(e.board, { ...e, n: (map.get(e.board)?.n ?? 0) + 1 });
    return [...map.values()].map((e) => ({ version: e.version, slug: e.slug, difficulty: e.difficulty, startYear: e.startYear, entries: e.n }));
  }
  async submissionsSince(ipHash: string, since: number) {
    return this.subs.filter((s) => s.ipHash === ipHash && s.at >= since).length;
  }
  async logSubmission(ipHash: string, at: number) {
    this.subs.push({ ipHash, at });
  }
  async pruneSubmissions(before: number) {
    this.subs = this.subs.filter((s) => s.at >= before);
  }
  async delete(id: number) {
    const n = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    return this.entries.length < n;
  }
  feedback: FeedbackItem[] = [];
  async insertFeedback(f: NewFeedback) {
    const id = this.feedback.length + 1;
    this.feedback.push({ id, ...f, status: "new" });
    return id;
  }
  async listFeedback(limit: number) {
    return [...this.feedback].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }
  async getFeedback(id: number) {
    return this.feedback.find((f) => f.id === id) ?? null;
  }
  async setFeedbackStatus(id: number, status: FeedbackItem["status"]) {
    const f = this.feedback.find((x) => x.id === id);
    if (f) f.status = status;
    return !!f;
  }
  async deleteFeedback(id: number) {
    const n = this.feedback.length;
    this.feedback = this.feedback.filter((f) => f.id !== id);
    return this.feedback.length < n;
  }
}
