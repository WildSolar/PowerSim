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
