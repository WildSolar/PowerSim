/**
 * The server (leaderboard and feedback) on this machine, in memory, for trying the game against it without Cloudflare:
 *
 *   npx -p typescript tsc -p tsconfig.test.json --outDir <somewhere> && node <somewhere>/leaderboard/test/devServer.js
 *
 * then start the game with VITE_LEADERBOARD_URL=http://localhost:8787 (app/.env.local). Entries
 * are gone when it stops.
 */

import { createServer } from "node:http";
import { handle } from "../src/index";
import { MemoryBlobs, MemoryStore } from "./memoryStore";

const PORT = 8787;
const store = new MemoryStore();
const blobs = new MemoryBlobs();
// No e-mail here: what would be sent is printed instead.
const sendMail = async (subject: string, text: string) => console.log(`--- mail: ${subject}
${text}
---`);

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length > 0 ? Buffer.concat(chunks).toString("utf8") : undefined;
  const headers: Record<string, string> = { "CF-Connecting-IP": req.socket.remoteAddress ?? "local" };
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k] = v;
  const request = new Request(`http://localhost:${PORT}${req.url}`, { method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : body });
  const response = await handle(request, store, { ALLOWED_ORIGINS: "http://localhost:5173", ADMIN_TOKEN: "dev", IP_SALT: "dev" }, Date.now(), { blobs, sendMail, waitUntil: () => {} });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(await response.text());
}).listen(PORT, () => console.log(`Leaderboard (in memory) on http://localhost:${PORT}`));
