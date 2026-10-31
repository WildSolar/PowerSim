#!/usr/bin/env node
/**
 * Does each measure do what it says? (src/dev/measureAudit.ts) Runs a municipality with nothing
 * enacted and once per measure, many at once, and prints what moved against what the measure promises.
 *
 *   npm run measure-audit -- --slug schlieren --out audit-results     all of them
 *   npm run measure-audit -- --only ev-grant,ev-grant:max --out …     just these (and the baselines)
 *   npm run measure-audit -- --report --out audit-results             the table again, without running
 *
 * Each run is a child process of its own, as for par (scripts/par.mjs). A run's result is kept in the
 * --out folder, and is not run again unless deleted.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = fileURLToPath(import.meta.url);

async function loadAudit() {
  globalThis.window = globalThis;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (/^https?:/.test(u)) return realFetch(url, init);
    const file = path.join(APP_DIR, "public", decodeURIComponent(u.replace(/^\/+/, "").split("?")[0]));
    try {
      return new Response(await readFile(file), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  };
  const { createServer } = await import("vite");
  const server = await createServer({
    root: APP_DIR,
    configFile: path.join(APP_DIR, "vite.config.ts"),
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
    logLevel: "error",
  });
  return { server, audit: await server.ssrLoadModule("/src/dev/measureAudit.ts") };
}

/** One run: prints `RESULT <json>`; or, with the name "--list", the tests. */
async function child(name, slug) {
  const { server, audit } = await loadAudit();
  try {
    if (name === "--list") console.log(`RESULT ${JSON.stringify(audit.AUDIT_TESTS)}`);
    else console.log(`RESULT ${JSON.stringify(await audit.runAuditTest(name, slug, (m) => console.log(`PROGRESS ${m}`)))}`);
  } finally {
    await server.close();
  }
}

function runChild(name, slug) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ["--max-old-space-size=4096", SCRIPT, "--child", name, slug], { cwd: APP_DIR, stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", (code) => {
      const line = out.split("\n").find((l) => l.startsWith("RESULT "));
      if (code === 0 && line) resolve(JSON.parse(line.slice(7)));
      else reject(new Error(`${name} failed (exit ${code})`));
    });
  });
}

const fileName = (name) => `${name.replace(/:/g, "__")}.json`;

function read(row, keyPath) {
  return keyPath.split(".").reduce((v, k) => (v === undefined || v === null ? undefined : v[k]), row);
}

/** The table: each test's expectations against its baseline. */
async function report(tests, dir) {
  const load = async (name) => {
    const f = path.join(dir, fileName(name));
    return existsSync(f) ? JSON.parse(await readFile(f, "utf8")) : null;
  };
  const results = new Map();
  for (const t of tests) results.set(t.name, await load(t.name));
  const lines = [];
  let bad = 0;
  for (const t of tests) {
    if (t.name.startsWith("base")) continue;
    const rows = results.get(t.name);
    const base = results.get(t.against ?? "base");
    if (!rows || !base) {
      lines.push(`?    ${t.name}: not run`);
      continue;
    }
    const middle = rows[Math.floor(rows.length / 2)].year;
    const parts = t.expect.map(([p, op, year]) => {
      const y = year ?? middle;
      const a = read(rows.find((r) => r.year === y), p);
      const b = read(base.find((r) => r.year === y), p);
      const ok = a !== undefined && b !== undefined && (op === ">" ? a > (b ?? 0) : a < b);
      if (!ok) bad++;
      const rel = b ? ` ${a >= b ? "+" : ""}${(((a - b) / b) * 100).toFixed(1)}%` : "";
      return `${ok ? "ok " : "NO "} ${p}@${y} ${op} : ${fmt(b)} -> ${fmt(a)}${rel}`;
    });
    lines.push(`${t.name}\n    ${parts.join("\n    ") || "(nothing to compare)"}`);
  }
  console.log(lines.join("\n"));
  console.log(`\n${bad} expectation(s) not met.`);
}

function fmt(v) {
  if (typeof v !== "number") return String(v);
  return Math.abs(v) < 10 ? v.toFixed(3) : Math.round(v).toLocaleString("en-GB");
}

async function parent(args) {
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const slug = get("--slug") ?? "schlieren";
  const dir = path.resolve(get("--out") ?? "audit-results");
  const jobs = Number(get("--jobs") ?? Math.max(1, Math.floor(os.cpus().length / 2)));
  const only = get("--only")?.split(",");
  await mkdir(dir, { recursive: true });
  const tests = await new Promise((resolve, reject) => {
    runChild("--list", slug).then(resolve, reject);
  });
  if (args.includes("--report")) return report(tests, dir);

  const wanted = tests.filter((t) => !only || only.includes(t.name) || t.name.startsWith("base"));
  const queue = wanted.filter((t) => !existsSync(path.join(dir, fileName(t.name))));
  const total = queue.length;
  let done = 0;
  const started = Date.now();
  console.log(`${total} runs on ${slug}, ${jobs} at a time.`);
  await Promise.all(
    Array.from({ length: jobs }, async () => {
      while (queue.length > 0) {
        const t = queue.shift();
        try {
          const rows = await runChild(t.name, slug);
          await writeFile(path.join(dir, fileName(t.name)), JSON.stringify(rows));
          console.log(`  [${++done}/${total}] ${t.name} (${Math.round((Date.now() - started) / 1000)} s)`);
        } catch (e) {
          console.log(`  [${++done}/${total}] ${t.name} FAILED: ${e.message}`);
        }
      }
    }),
  );
  await report(tests, dir);
}

if (process.argv[2] === "--child") await child(process.argv[3], process.argv[4]);
else await parent(process.argv.slice(2));
