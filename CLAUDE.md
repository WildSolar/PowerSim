# Grid & Ground — project notes

## In-game wiki

`app/src/ui/wikiContent.ts` is the source of the in-game Wiki (opened via the
"📖 Wiki" button, bottom-left). It's plain data (an array of sections, each a
list of paragraph/list/note blocks) precisely so it's cheap to keep current.

**When a change adds or meaningfully alters a simulated mechanic** (a new
device, a new data source driving ownership, a new tariff behavior, a new map
layer, a new statistics view, etc.), **update the matching wiki section in the
same change** — add a new section if nothing existing covers it. Keep the tone
player-facing (what it does, what drives it) rather than implementation detail;
use a `note()` block for known simplifications worth being upfront about,
matching the existing sections' style.
