/**
 * Tries the Worker's request handler (src/index.ts) against an in-memory store, and the name
 * filter (rules.ts) against names that should and shouldn't pass. Run from this folder:
 *
 *   npx -p typescript tsc -p tsconfig.test.json --outDir <somewhere> && node <somewhere>/leaderboard/test/run.js
 */

import { nameProblem, type Submission } from "../../app/src/leaderboard/rules";
import { handle } from "../src/index";
import type { Store } from "../src/store";
import { MemoryBlobs, MemoryStore } from "./memoryStore";

let failures = 0;
function expect(label: string, ok: boolean, detail = ""): void {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}

/** A run: emissions per resident falling linearly from the start to `endKg` in 2050. */
function run(name: string, endKg: number, opts: Partial<Submission> = {}): Submission {
  const base = 5000;
  const years = [];
  let score = 0;
  for (let y = 2027; y <= 2050; y++) {
    const p = base + ((endKg - base) * (y - 2026)) / 24;
    years.push({ year: y, perResidentKg: p });
    score += 100 * (1 - p / base);
  }
  return {
    version: "0.9",
    fullVersion: "0.9.0",
    build: "abc1234",
    slug: "schlieren",
    difficulty: "normal",
    startYear: 2026,
    runId: crypto.randomUUID(),
    name,
    baselinePerResidentKg: base,
    years,
    finishedYear: null,
    par: 300,
    score,
    ...opts,
  };
}

async function call(store: Store, method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = 1_800_000_000_000) {
  const request = new Request(`https://lb.example${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Origin: "http://localhost:5173", "CF-Connecting-IP": "203.0.113.7", ...headers } });
  const response = await handle(request, store, { ALLOWED_ORIGINS: "http://localhost:5173", ADMIN_TOKEN: "secret-token", IP_SALT: "salt" }, now);
  return { status: response.status, body: (await response.json().catch(() => null)) as Record<string, unknown> | null, cors: response.headers.get("Access-Control-Allow-Origin") };
}

async function main(): Promise<void> {
  // --- names ---
  const good = ["Michael", "Zoë Müller", "Anna-Lena", "Jean-Pierre O'Neil", "Team 42", "Glasser", "Dickens", "Cumberland", "Sussex", "Assassin", "Therapist Tom", "Scunthorpe FC", "Hancock", "Ace as King", "Matsushita", "Arsenal", "Analytics", "Nazionale", "Peacock", "Minute Man", "Unique", "Technique", "Fickle", "Grape Fan", "Montenegro"];
  for (const n of good) expect(`name passes: ${n}`, nameProblem(n) === null, nameProblem(n) ?? "");
  const bad = ["fuck", "F.u.c.k", "fuuuuck", "fυck", "Fu<k", "f u c k", "MotherFucker", "ShitHead", "sh1t", "a$$", "Ass", "Hitler", "H1tler", "Heil", "Nazi", "kkk", "KKKlan", "1488", "Arschloch", "Hurensohn", "Fotze", "Hure", "Wichser", "Salope", "Connard", "Enculé", "Putain", "Cazzo", "Vaffanculo", "Stronzo", "nigger", "N1gga", "Faggot", "retard", "admin", "www.spam.com", "x", "a".repeat(30), "Zalgó́́́", "Right‮left", "zero​width", "AAAAAAA"];
  for (const n of bad) expect(`name refused: ${JSON.stringify(n)}`, nameProblem(n) !== null, nameProblem(n) ?? "passed!");

  // --- the handler ---
  const store = new MemoryStore();
  const a = await call(store, "POST", "/submit", run("Michael", -50));
  expect("a good run is accepted", a.status === 201, JSON.stringify(a.body));
  expect("CORS for the allowed origin", a.cors === "http://localhost:5173");
  const b = await call(store, "POST", "/submit", run("Anna", 2000));
  expect("a weaker run ranks second", b.status === 201 && b.body?.rank === 2 && b.body?.entries === 2, JSON.stringify(b.body));
  const dup = run("Michael again", -50);
  await call(store, "POST", "/submit", dup);
  const again = await call(store, "POST", "/submit", dup);
  expect("the same run twice is refused", again.status === 409, JSON.stringify(again.body));
  const lie = run("Liar", 2000);
  lie.score = 2400;
  expect("a score that doesn't add up is refused", (await call(store, "POST", "/submit", lie)).status === 422);
  const gaps = run("Gaps", 0);
  gaps.years = gaps.years.slice(0, 10);
  expect("missing years are refused", (await call(store, "POST", "/submit", gaps)).status === 422);
  const early = run("Early", 0, { finishedYear: 2040 });
  early.years = early.years.map((y) => (y.year > 2040 ? { year: y.year, perResidentKg: 0, projected: true } : y));
  early.score = early.years.reduce((s, y) => s + (y.projected ? 100 : 100 * (1 - y.perResidentKg / 5000)), 0);
  expect("finishing early without net zero is refused", (await call(store, "POST", "/submit", early)).status === 422);
  expect("a rude name is refused", (await call(store, "POST", "/submit", run("Arschloch", 0))).status === 422);
  expect("junk is refused", (await call(store, "POST", "/submit", { hello: 1 })).status === 400);
  expect("not JSON is refused", (await handle(new Request("https://lb.example/submit", { method: "POST", body: "{" }), store, {})).status === 400);

  // Rate limit: five an hour from one address (four so far, incl. the duplicate's first).
  const flood = [];
  for (let i = 0; i < 4; i++) flood.push((await call(store, "POST", "/submit", run(`Flood ${i}`, 1000 + i))).status);
  expect("the sixth in an hour is refused", flood.includes(429), flood.join(","));
  const later = await call(store, "POST", "/submit", run("Later", 500), {}, 1_800_000_000_000 + 2 * 3_600_000);
  expect("an hour later it's fine again", later.status === 201, JSON.stringify(later.body));

  const scores = await call(store, "GET", "/scores?version=0.9&slug=schlieren&difficulty=normal&startYear=2026&limit=10");
  const entries = (scores.body?.entries ?? []) as { name: string; score: number }[];
  expect("the board lists highest first", entries.length >= 3 && entries[0].score >= entries[1].score, entries.map((e) => `${e.name}:${e.score}`).join(" "));
  expect("a bad board query is refused", (await call(store, "GET", "/scores?version=x")).status === 400);
  const boards = await call(store, "GET", "/boards");
  expect("boards are listed", Array.isArray(boards.body?.boards) && (boards.body!.boards as unknown[]).length === 1, JSON.stringify(boards.body));

  expect("delete without the token is refused", (await call(store, "DELETE", "/scores/1")).status === 403);
  expect("delete with the token works", (await call(store, "DELETE", "/scores/1", undefined, { Authorization: "Bearer secret-token" })).status === 200);
  const upper = await handle(new Request("https://lb.example/boards", { headers: { Origin: "http://localhost:5173" } }), store, { ALLOWED_ORIGINS: "http://LocalHost:5173" });
  expect("origins compare without case", upper.headers.get("Access-Control-Allow-Origin") === "http://localhost:5173");
  expect("a stranger's origin gets no CORS", (await call(store, "GET", "/boards", undefined, { Origin: "https://evil.example" })).cors === null);
  expect("preflight answers", (await call(store, "OPTIONS", "/submit")).status === 204);

  // --- feedback ---
  const fbStore = new MemoryStore();
  const blobs = new MemoryBlobs();
  const mails: { subject: string; text: string }[] = [];
  const pending: Promise<unknown>[] = [];
  const deps = { blobs, sendMail: async (subject: string, text: string) => void mails.push({ subject, text }), waitUntil: (p: Promise<unknown>) => void pending.push(p) };
  const env = { ALLOWED_ORIGINS: "http://localhost:5173", ADMIN_TOKEN: "secret-token", IP_SALT: "salt" };
  const fb = (body: unknown, headers: Record<string, string> = {}, path = "/feedback", method = "POST") =>
    handle(
      new Request(`https://lb.example${path}`, { method, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body), headers: { Origin: "http://localhost:5173", "CF-Connecting-IP": "198.51.100.9", ...headers } }),
      fbStore,
      env,
      1_800_000_000_000,
      deps,
    );
  const feedback = { kind: "An idea", message: "More wind, please.\nAnd <b>bold</b> ideas.", details: "Version: 0.9.0\nBrowser: test", version: "0.9.0", build: "abc", crash: false, save: "CZ1:aGVsbG8=" };
  const posted = await fb(feedback);
  await Promise.all(pending);
  expect("feedback is accepted", posted.status === 201);
  expect("its save is kept", blobs.items.get("feedback/1.txt") === "CZ1:aGVsbG8=");
  expect("an e-mail goes out", mails.length === 1 && mails[0].subject.includes("#1") && mails[0].text.includes("https://lb.example/admin"), mails[0]?.subject ?? "none");
  expect("empty feedback is refused", (await fb({ ...feedback, message: " ", save: null })).status === 422);
  expect("a crash report needs no words", (await fb({ ...feedback, message: "", crash: true, save: null })).status === 201);
  expect("junk feedback is refused", (await fb("{nope")).status === 400);
  expect("the admin list needs the token", (await fb(undefined, {}, "/admin/feedback", "GET")).status === 403);
  const list = await fb(undefined, { Authorization: "Bearer secret-token" }, "/admin/feedback", "GET");
  const items = ((await list.json()) as { items: { id: number; message: string; hasSave: boolean }[] }).items;
  expect("the admin list has both", items.length === 2 && items.some((i) => i.hasSave), JSON.stringify(items.map((i) => i.id)));
  const saveRes = await fb(undefined, { Authorization: "Bearer secret-token" }, "/admin/feedback/1/save", "GET");
  expect("the save downloads", saveRes.status === 200 && (await saveRes.text()) === "CZ1:aGVsbG8=");
  expect("marking done works", (await fb({ status: "done" }, { Authorization: "Bearer secret-token" }, "/admin/feedback/1/status")).status === 200 && (await fbStore.getFeedback(1))?.status === "done");
  expect("deleting removes the save too", (await fb(undefined, { Authorization: "Bearer secret-token" }, "/admin/feedback/1", "DELETE")).status === 200 && !blobs.items.has("feedback/1.txt"));
  const page = await fb(undefined, {}, "/admin", "GET");
  const html = await page.text();
  const csp = page.headers.get("Content-Security-Policy") ?? "";
  const nonce = /nonce-([0-9a-f]+)/.exec(csp)?.[1] ?? "";
  expect("the admin page is served with a strict policy", page.status === 200 && csp.includes("default-src 'none'") && nonce.length > 10 && html.includes(`nonce="${nonce}"`) && !html.includes("secret-token"));
  const fbFlood: number[] = [];
  for (let i = 0; i < 6; i++) fbFlood.push((await fb({ ...feedback, save: null })).status);
  expect("feedback is limited per hour", fbFlood.includes(429), fbFlood.join(","));

  console.log(failures === 0 ? "\nAll passed." : `\n${failures} failed.`);
  if (failures > 0) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
}

void main();
