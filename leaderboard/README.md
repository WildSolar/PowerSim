# Commune Zéro — leaderboard

A Cloudflare Worker (`src/index.ts`) with a D1 database (`schema.sql`). The game talks to it from
the end screen and the start screen (`app/src/leaderboard/`); the rules both sides apply — what a
submission is, the name filter, the score worked out again — are in `app/src/leaderboard/rules.ts`.
Without a leaderboard address in the build, the game simply has no leaderboard.

## Setting it up (once)

All commands from this folder (`leaderboard/`). `npx wrangler` fetches Cloudflare's command-line
tool the first time.

1. **Log in** — opens the browser to let wrangler use your Cloudflare account:

   ```
   npx wrangler login
   ```

2. **Create the database**, and copy the `database_id` it prints into `wrangler.toml`
   (replacing `<database-id>`):

   ```
   npx wrangler d1 create commune-zero-leaderboard
   ```

3. **Allow the game's address**: in `wrangler.toml`, replace `<owner>` in `ALLOWED_ORIGINS` with
   your GitHub user name (the game lives at `https://<owner>.github.io/<repository>/`; only the
   origin, `https://<owner>.github.io`, goes here).

4. **Create the tables**:

   ```
   npx wrangler d1 execute commune-zero-leaderboard --remote --file=schema.sql
   ```

5. **Set two secrets** — each asks for a value; type any long random string (keep the admin token
   somewhere safe, you need it to remove entries):

   ```
   npx wrangler secret put ADMIN_TOKEN
   npx wrangler secret put IP_SALT
   ```

6. **Deploy**. The first time, Cloudflare asks you to pick a `workers.dev` subdomain. It prints the
   Worker's address, `https://commune-zero-leaderboard.<subdomain>.workers.dev`:

   ```
   npx wrangler deploy
   ```

   Check it: opening `<address>/boards` in a browser shows `{"boards":[]}`.

7. **Tell the game**: on GitHub, Settings → Secrets and variables → Actions → Variables → New
   repository variable: `LEADERBOARD_URL` = the Worker's address. Then run the "Deploy to GitHub
   Pages" workflow again; the Leaderboard button appears on the start screen.

To try the leaderboard from the dev server (`npm run dev`), put
`VITE_LEADERBOARD_URL=<address>` in `app/.env.local` (not committed) — `http://localhost:5173` is
already allowed.

## Looking after it

After changing `src/` or `app/src/leaderboard/rules.ts`, deploy again with `npx wrangler deploy`.

The latest entries, with their ids:

```
npx wrangler d1 execute commune-zero-leaderboard --remote --command "SELECT id, name, score, board, submitted_at FROM entries ORDER BY id DESC LIMIT 30"
```

Removing one (with the admin token from step 5):

```
curl -X DELETE -H "Authorization: Bearer <admin-token>" <address>/scores/<id>
```

or straight in the database:

```
npx wrangler d1 execute commune-zero-leaderboard --remote --command "DELETE FROM entries WHERE id = <id>"
```

Words the name filter refuses are in `app/src/leaderboard/blocklist.ts`; after changing it,
deploy both the Worker and the game.

## Testing without Cloudflare

The handler runs against an in-memory store in Node, with the app's TypeScript:

```
../app/node_modules/.bin/tsc -p tsconfig.test.json --outDir ../.lbtest
node ../.lbtest/leaderboard/test/run.js          # the tests: names, scores, limits, removal
node ../.lbtest/leaderboard/test/devServer.js    # a local leaderboard on http://localhost:8787
```

## What it keeps

Per entry: the name, the board (version, town, difficulty, starting year), the score worked out
from the run's years, par, the net-zero and hand-over years, the game's version and build, and when.
For the rate limit (five submissions an hour per connection), a salted hash of the address, deleted
after a day. Nothing else.
