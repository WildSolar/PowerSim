#!/usr/bin/env node
/**
 * Computes par (src/sim/par.ts) — the do-nothing run of a municipality at each difficulty, through
 * 2050 — outside the browser, many at once, and writes public/data/par/<slug>.json.
 *
 *   npm run par -- schlieren uster          the towns named
 *   npm run par -- --all                    every town in public/data/index.json
 *   npm run par -- schlieren --difficulties normal,hard
 *   npm run par -- --all --jobs 8           at most 8 at a time (default: cores − 2)
 *
 * Each run is a child process of its own (the game's modules keep state, so one run per process),
 * loading the game's code through Vite exactly as the browser does — the results are the same as
 * the console's __computePar. A town's file is written once all its difficulties are done; a
 * failed run leaves that town's file as it was.
 */

import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(APP_DIR, "public", "data");
const ALL_DIFFICULTIES = ["easy", "normal", "hard"];

if (process.argv[2] === "--child") await child(process.argv[3], process.argv[4]);
else await parent(process.argv.slice(2));

// --- one run ---------------------------------------------------------------------------------

/** One town at one difficulty: prints progress lines, then `RESULT <json>`. */
async function child(slug, difficulty) {
  // A few modules hang dev helpers on window as they load; the game fetches its data by URL.
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
  const timer = setInterval(() => {
    if (globalThis.__parProgress) console.log(`PROGRESS ${globalThis.__parProgress}`);
  }, 15_000);
  try {
    const { computePar } = await server.ssrLoadModule("/src/dev/par.ts");
    const result = await computePar(slug, difficulty);
    console.log(`RESULT ${JSON.stringify(result)}`);
  } finally {
    clearInterval(timer);
    await server.close();
  }
}

// --- all of them -------------------------------------------------------------------------------

function usage(message) {
  if (message) console.error(message);
  console.error("Usage: npm run par -- <slug> [<slug>…] | --all  [--difficulties easy,normal,hard] [--jobs N]");
  process.exit(1);
}

async function parent(args) {
  let all = false;
  let difficulties = ALL_DIFFICULTIES;
  let jobs = Math.max(1, os.cpus().length - 2);
  const slugs = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--all") all = true;
    else if (a === "--difficulties") difficulties = (args[++i] ?? "").split(",").filter(Boolean);
    else if (a === "--jobs") jobs = Math.max(1, Number(args[++i]) || 1);
    else if (a.startsWith("--")) usage(`Unknown option ${a}`);
    else slugs.push(a);
  }
  if (difficulties.some((d) => !ALL_DIFFICULTIES.includes(d)) || difficulties.length === 0) usage("Difficulties are easy, normal and hard.");

  const index = JSON.parse(await readFile(path.join(DATA_DIR, "index.json"), "utf8"));
  const known = new Map(index.map((m) => [m.slug, m]));
  const towns = all ? index.map((m) => m.slug) : slugs;
  if (towns.length === 0) usage("Name at least one town, or --all.");
  for (const s of towns) if (!known.has(s)) usage(`No town "${s}" in public/data/index.json.`);

  // Biggest towns first, so the longest runs don't start last.
  const runs = towns
    .flatMap((slug) => difficulties.map((difficulty) => ({ slug, difficulty })))
    .sort((a, b) => (known.get(b.slug).buildingCount ?? 0) - (known.get(a.slug).buildingCount ?? 0));
  jobs = Math.min(jobs, runs.length);
  console.log(`Par for ${towns.length} town${towns.length === 1 ? "" : "s"} × ${difficulties.join(", ")}: ${runs.length} runs, ${jobs} at a time.`);

  const started = Date.now();
  const elapsed = () => `${Math.round((Date.now() - started) / 1000)} s`;
  const results = new Map(); // slug → { difficulty → result }
  const failed = [];
  let next = 0;

  const runOne = ({ slug, difficulty }) =>
    new Promise((resolve) => {
      const tag = `${slug}/${difficulty}`;
      const proc = spawn(process.execPath, [fileURLToPath(import.meta.url), "--child", slug, difficulty], { cwd: APP_DIR, stdio: ["ignore", "pipe", "pipe"] });
      let result = null;
      let errors = "";
      let buffer = "";
      proc.stdout.on("data", (chunk) => {
        buffer += chunk;
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line.startsWith("RESULT ")) result = JSON.parse(line.slice(7));
          else if (line.startsWith("PROGRESS ")) console.log(`  ${tag}: ${line.slice(9)}`);
        }
      });
      proc.stderr.on("data", (chunk) => (errors += chunk));
      proc.on("close", (code) => {
        if (code === 0 && result) {
          if (!results.has(slug)) results.set(slug, {});
          results.get(slug)[difficulty] = result;
          console.log(`✓ ${tag} (${elapsed()}): ${Math.round(result.points.reduce((s, p) => s + p, 0))} points`);
        } else {
          failed.push(tag);
          console.error(`✗ ${tag} failed (exit ${code}):\n${errors.trim().split("\n").slice(-12).join("\n")}`);
        }
        resolve();
      });
    });

  const worker = async () => {
    while (next < runs.length) await runOne(runs[next++]);
  };
  await Promise.all(Array.from({ length: jobs }, worker));

  // A town's file, once every difficulty asked for is done.
  await mkdir(path.join(DATA_DIR, "par"), { recursive: true });
  for (const slug of towns) {
    const done = results.get(slug) ?? {};
    if (!difficulties.every((d) => done[d])) {
      console.error(`${slug}: not written — a run failed.`);
      continue;
    }
    const file = path.join(DATA_DIR, "par", `${slug}.json`);
    // Difficulties not recomputed now are kept, if they belong to the same version and start year.
    let previous = null;
    try {
      previous = JSON.parse(await readFile(file, "utf8"));
    } catch {
      previous = null;
    }
    const sample = done[difficulties[0]];
    const keep = previous && previous.version === sample.version && previous.baselineYear === sample.baselineYear ? previous.difficulties : {};
    const out = { version: sample.version, baselineYear: sample.baselineYear, difficulties: {} };
    for (const d of ALL_DIFFICULTIES) {
      const r = done[d];
      if (r) out.difficulties[d] = { firstYear: r.firstYear, points: r.points };
      else if (keep[d]) out.difficulties[d] = keep[d];
    }
    await writeFile(file, formatPar(out), "utf8");
    console.log(`Wrote public/data/par/${slug}.json (${Object.keys(out.difficulties).join(", ")}).`);
  }
  console.log(`Done in ${elapsed()}${failed.length ? `; ${failed.length} failed: ${failed.join(", ")}` : ""}.`);
  if (failed.length) process.exitCode = 1;
}

/** The file as the repository keeps it: each difficulty's points on one line. */
function formatPar(out) {
  const ds = Object.keys(out.difficulties);
  const lines = ["{", `  "version": ${JSON.stringify(out.version)},`, `  "baselineYear": ${out.baselineYear},`, '  "difficulties": {'];
  ds.forEach((d, i) => {
    const v = out.difficulties[d];
    lines.push(`    "${d}": {`, `      "firstYear": ${v.firstYear},`, `      "points": [${v.points.join(", ")}]`, `    }${i < ds.length - 1 ? "," : ""}`);
  });
  lines.push("  }", "}", "");
  return lines.join("\n");
}
