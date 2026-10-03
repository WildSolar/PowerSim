# Grid & Ground — project notes

## In-game wiki

`app/src/ui/wikiContent.ts` is the source of the in-game Wiki (opened via the
Wiki button in the top bar). It's plain data (an array of sections, each a
list of paragraph/list/note blocks) precisely so it's cheap to keep current.

**When a change adds or meaningfully alters a simulated mechanic** (a new
device, a new data source driving ownership, a new tariff behavior, a new map
layer, a new statistics view, etc.), **update the matching wiki section in the
same change** — add a new section if nothing existing covers it. Keep the tone
player-facing (what it does, what drives it) rather than implementation detail;
use a `note()` block for known simplifications worth being upfront about,
matching the existing sections' style.

A new section must also be listed in a group in `WIKI_GROUPS` (bottom of the
file), which sets the wiki's contents and reading order. To link to another
section, name it in escaped quotes (`\"Stock renewal\"`): the name must equal
its title, or the part of the title before a colon. List items that open with
a short label (`"Cost: ..."`, `"Noise. ..."`, `"Fridge — ..."`) show it in bold.
