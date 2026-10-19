# Commune Zéro — server (leaderboard and feedback)

A Cloudflare Worker (`src/index.ts`) with a D1 database (`schema.sql`) and an R2 bucket. The game
talks to it for the leaderboard (end screen, start screen) and to send feedback (`app/src/leaderboard/`,
`app/src/ui/feedback.ts`); the rules both sides apply — what a submission is, the name filter, the
score worked out again, what feedback may contain — are in `app/src/leaderboard/rules.ts`. Feedback
is e-mailed to the admin through Resend (`src/mail.ts`) and listed on the admin page,
`<address>/admin` (`src/adminPage.ts`). Without the server's address in the build, the game has no
leaderboard and falls back to e-mail for feedback.

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

## Feedback (once)

8. **A bucket for the games attached to feedback**:

   ```
   npx wrangler r2 bucket create commune-zero-feedback
   ```

   (Cloudflare may ask you to enable R2 on the account first, in the dashboard under R2 — free up
   to 10 GB, but it asks for a payment method on file.)

9. **The feedback table** — the schema again (it only adds what's missing):

   ```
   npx wrangler d1 execute commune-zero-leaderboard --remote --file=schema.sql
   ```

10. **Resend, for the e-mail** (resend.com, free up to 3,000 mails a month):
    - Sign up, then Domains → Add domain → `commune-zero.ch` (region: Europe).
    - Resend shows a few DNS records (a TXT record for DKIM, and an MX and a TXT record for a
      `send` subdomain). Add each at Hostpoint exactly as shown — names and values. They don't
      touch your own mail at `admin@commune-zero.ch`.
    - Back at Resend, click Verify (minutes to an hour).
    - API Keys → Create API key (permission: sending access, domain: commune-zero.ch), and give it
      to the Worker:

      ```
      npx wrangler secret put RESEND_API_KEY
      ```

    Where it goes and who it's from are `FEEDBACK_TO` and `FEEDBACK_FROM` in `wrangler.toml`.

11. **Deploy the Worker** (`npx wrangler deploy`), and on GitHub set the repository variable
    `FEEDBACK_EMAIL` to `admin@commune-zero.ch` (the address shown if sending ever fails), then
    deploy the game.

Reading feedback: open `<address>/admin`, enter the admin token (kept for that browser tab only).
Each report shows its details; "Download the game" saves the player's run as a `.txt` file that
loads from the game's start screen (Load game → from a file).

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
node ../.lbtest/leaderboard/test/run.js          # the tests: names, scores, limits, removal, feedback
node ../.lbtest/leaderboard/test/devServer.js    # a local server on http://localhost:8787 (admin token: dev; mails are printed)
```

## What it keeps

Per leaderboard entry: the name, the board (version, town, difficulty, starting year), the score
worked out from the run's years, par, the net-zero and hand-over years, the game's version and
build, and when. Per feedback: what it's about, the message, the details the game adds (version,
town, in-game date, approval, browser, screen size, a crash's error), and the attached game if the
player ticked it (in R2). For the rate limits (five scores, six feedbacks an hour per connection), a
salted hash of the address, deleted after a day. Nothing else.
