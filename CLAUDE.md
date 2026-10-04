# Commune Zéro — project notes

## In-game wiki

`app/src/ui/wikiContent.ts` is the source of the in-game Wiki (opened via the
Wiki button in the top bar). It's plain data (an array of sections, each a
list of paragraph/list/note blocks) precisely so it's cheap to keep current.

**When a change adds or meaningfully alters a simulated mechanic** (a new
device, a new data source driving ownership, a new tariff behavior, a new map
layer, a new statistics view, etc.), **update the matching wiki section in the
same change** — add a new section if nothing existing covers it. Write for the
player, in the second person: what they see, what drives it, and what they can
do about it — never how the code does it (no "seeded", "cached", "four-factor",
"placeholder"). Write about any Swiss municipality, never Schlieren in
particular (the game covers all of them). Use a `note()` block to say plainly
where the game simplifies, matching the existing sections' style.

A new section must also be listed in a group in `WIKI_GROUPS` (bottom of the
file), which sets the wiki's contents and reading order. To link to another
section, name it in escaped straight quotes (`\"When things wear out\"`): the
name must equal its title, or the part of the title before a colon. Ordinary
quotations use typographic quotes (‘ ’, “ ”) so they never turn into links. List items that open with
a short label (`"Cost: ..."`, `"Noise. ..."`, `"Fridge — ..."`) show it in bold.

## Saving and loading

A save (`app/src/sim/saveGame.ts`) is a snapshot of every stateful module, not a
replay — households decide lazily under the policy of the moment, so only the
state reproduces a run. Each module has `snapshot()`/`restore()` (or
`snapshotX`/`restoreX` functions), called from `captureState` and `applySave`.

**When a change adds state that changes during play** (a new field on a sim
class, a module-level Map, a new building attribute set after the start),
**add it to that module's snapshot and restore in the same change** — anything
left out silently resets to its start value on load. State rebuilt from the
dataset and the seeds (geometry, profiles, weather, rates, spatial indexes) and
pure caches stay out. Check a change with the round trip: in dev, load a save
and compare `window.__stateAfterLoad` with the saved state.

Saves carry the git commit (`__GAME_VERSION__`, vite.config.ts) and only load
into the same build; there is no migration yet.

## Versions and the changelog

`app/src/changelog.ts` holds the public version and the changelog (newest
release first), shown in game under "What's new" (start screen, game menu).
The first entry is the release in progress while its `date` is null; the
game then calls itself "<version>-dev". Versions are 0.MINOR.PATCH during the
beta: MINOR for new features or balance changes, PATCH for fixes only.

**When a change is visible to players** (a feature, a balance change, a fix
they would notice), **add a line to the in-progress release in the same
change** — under `added`, `changed` or `fixed`, written for the player like
the wiki. If the newest entry already has a date (it was released), first
start a new in-progress entry above it with the next version and `date: null`.

To release: set the entry's `date` (YYYY-MM-DD), set `version` in
`app/package.json` to match, commit as "Release X.Y.Z", and tag it `vX.Y.Z`.
Saves still check the exact build (git commit), not the public version.

## Score and par

The score (`app/src/sim/score.ts`) sums each year's cut in net emissions per
resident against the starting year, 2027–2050; net zero by 2050 wins.
Par (`app/src/sim/par.ts`) is the do-nothing run, shipped per municipality in
`app/public/data/par/<slug>.json` for each difficulty, and only used by games
that started in the same year (`baselineYear`).

**When a change alters the simulation's outcome** (balance, a mechanic, new
data), **recompute par** for the shipped municipalities: from the start
screen's console, one difficulty per page load,
`window.__x = null; __computePar("schlieren", "normal").then((r) => (window.__x = r))`
(it runs for minutes; poll `window.__x`), then write the three results into the
par file. Par also has to be recomputed when the calendar year changes, since
a game always starts in the current year.
