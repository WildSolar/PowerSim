#!/usr/bin/env node
/**
 * Computes where each town's emissions come from in its starting year (src/sim/startEmissions.ts),
 * outside the browser, and writes public/data/start-emissions.json. One year per town, so far
 * quicker than par.
 *
 *   npm run start-emissions -- schlieren uster
 *   npm run start-emissions -- --all             every town in public/data/index.json
 *   npm run start-emissions -- --all --jobs 8    at most 8 at a time (default: half the logical cores)
 *
 * Towns not named keep what the file has for them.
 */

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(APP_DIR, "public", "data");
const OUT = path.join(DATA_DIR, "start-emissions.json");

if (process.argv[2] === "--child") await child(process.argv[3]);
else await parent(process.argv.slice(2));

/** One town: prints `RESULT <json>`. Each in a process of its own, as the game's modules keep state. */
async function child(slug) {
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
  const server = await createServer({ root: APP_DIR, configFile: path.join(APP_DIR, "vite.config.ts"), server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", logLevel: "error" });
  try {
    const { computeStartEmissions } = await server.ssrLoadModule("/src/dev/par.ts");
    console.log(`RESULT ${JSON.stringify(await computeStartEmissions(slug))}`);
  } finally {
    await server.close();
  }
}

async function parent(args) {
  let all = false;
  let jobs = Math.max(1, Math.floor(os.cpus().length / 2));
  const slugs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--all") all = true;
    else if (args[i] === "--jobs") jobs = Math.max(1, Number(args[++i]) || 1);
    else slugs.push(args[i]);
  }
  const index = JSON.parse(await readFile(path.join(DATA_DIR, "index.json"), "utf8"));
  const towns = all ? index.map((m) => m.slug) : slugs;
  if (towns.length === 0) {
    console.error("Usage: npm run start-emissions -- <slug> [<slug>…] | --all  [--jobs N]");
    process.exit(1);
  }

  const results = {};
  const failed = [];
  let next = 0;
  const runOne = (slug) =>
    new Promise((resolve) => {
      const proc = spawn(process.execPath, [fileURLToPath(import.meta.url), "--child", slug], { cwd: APP_DIR, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let errors = "";
      proc.stdout.on("data", (chunk) => (out += chunk));
      proc.stderr.on("data", (chunk) => (errors += chunk));
      proc.on("close", (code) => {
        const line = out.split("\n").find((l) => l.startsWith("RESULT "));
        if (code === 0 && line) {
          results[slug] = JSON.parse(line.slice(7));
          console.log(`✓ ${slug}: ${JSON.stringify(results[slug])}`);
        } else {
          failed.push(slug);
          console.error(`✗ ${slug} failed (exit ${code}):\n${errors.trim().split("\n").slice(-12).join("\n")}`);
        }
        resolve();
      });
    });
  await Promise.all(Array.from({ length: Math.min(jobs, towns.length) }, async () => {
    while (next < towns.length) await runOne(towns[next++]);
  }));

  let previous = {};
  try {
    previous = JSON.parse(await readFile(OUT, "utf8"));
  } catch {
    previous = {};
  }
  const merged = { ...previous, ...results };
  const lines = Object.keys(merged).sort().map((slug) => `  ${JSON.stringify(slug)}: ${JSON.stringify(merged[slug])}`);
  await writeFile(OUT, `{\n${lines.join(",\n")}\n}\n`, "utf8");
  console.log(`Wrote public/data/start-emissions.json (${Object.keys(merged).length} towns)${failed.length ? `; ${failed.length} failed: ${failed.join(", ")}` : ""}.`);
  if (failed.length) process.exitCode = 1;
}
