import { Fragment, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Banknote, Building2, Car, Compass, Flame, Landmark, Plug, Search, Users, X, Zap } from "lucide-react";
import { WIKI_GROUPS, WIKI_SECTIONS, type WikiBlock, type WikiSection } from "./wikiContent";
import "./wiki.css";

const GROUP_ICON: Record<string, ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>> = {
  start: Compass,
  governing: Landmark,
  money: Banknote,
  decisions: Users,
  town: Building2,
  heating: Flame,
  electricity: Zap,
  mobility: Car,
  households: Plug,
};

const SECTION_BY_ID = new Map(WIKI_SECTIONS.map((s) => [s.id, s]));
const GROUP_OF = new Map(WIKI_GROUPS.flatMap((g) => g.sections.map((id) => [id, g] as const)));
/** Every section in reading order: group by group. */
const READING_ORDER = WIKI_GROUPS.flatMap((g) => g.sections);

if (import.meta.env.DEV) {
  const missing = WIKI_SECTIONS.filter((s) => !GROUP_OF.has(s.id)).map((s) => s.id);
  const unknown = READING_ORDER.filter((id) => !SECTION_BY_ID.has(id));
  if (missing.length || unknown.length) console.warn("Wiki: sections not in a group", missing, "unknown ids in groups", unknown);
}

/** A section a quoted name refers to: its title, or the part of its title before a colon. */
function sectionNamed(name: string): WikiSection | null {
  const n = name.toLowerCase();
  return WIKI_SECTIONS.find((s) => s.title.toLowerCase() === n || s.title.toLowerCase().startsWith(`${n}:`)) ?? null;
}

// Remembered between openings, so the wiki opens where it was left.
let lastSectionId: string | null = null;

function blockText(b: WikiBlock): string {
  return b.type === "list" ? (b.items ?? []).join(" ") : (b.text ?? "");
}

/** Text with its cross-references as links, and the search term marked. */
function RichText({ text, selfId, query, onOpen }: { text: string; selfId: string; query: string; onOpen: (id: string) => void }) {
  const parts = text.split(/("[^"]+")/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('"') && part.endsWith('"')) {
          const target = sectionNamed(part.slice(1, -1));
          if (target && target.id !== selfId) {
            return (
              <button key={i} className="wiki-ref" onClick={() => onOpen(target.id)}>
                {part.slice(1, -1)}
              </button>
            );
          }
        }
        return <Fragment key={i}>{mark(part, query)}</Fragment>;
      })}
    </>
  );
}

function mark(text: string, query: string): ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const out: ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(q); at >= 0; at = lower.indexOf(q, from)) {
    out.push(text.slice(from, at), <mark key={at}>{text.slice(at, at + q.length)}</mark>);
    from = at + q.length;
  }
  out.push(text.slice(from));
  return out;
}

/** A list item's short label, if it opens with one ("Lead time:", "Noise.", "Space —"), to set in bold. */
function leadIn(item: string): string | null {
  const m = /^([^:.—"]{2,40}?)(:|\.| —)\s/.exec(item);
  if (!m) return null;
  const words = m[1].trim().split(/\s+/).length;
  return words <= (m[2] === " —" ? 4 : 5) ? m[1] + m[2] : null;
}

function Article({ section, query, onOpen }: { section: WikiSection; query: string; onOpen: (id: string) => void }) {
  const group = GROUP_OF.get(section.id);
  const index = READING_ORDER.indexOf(section.id);
  const prev = index > 0 ? SECTION_BY_ID.get(READING_ORDER[index - 1]) : undefined;
  const next = index >= 0 && index < READING_ORDER.length - 1 ? SECTION_BY_ID.get(READING_ORDER[index + 1]) : undefined;
  const rich = (text: string) => <RichText text={text} selfId={section.id} query={query} onOpen={onOpen} />;
  return (
    <article className="wiki-article">
      {group && <div className="wiki-kicker">{group.title}</div>}
      <h1>{section.title}</h1>
      {section.blocks.map((block, i) => {
        if (block.type === "p") return <p key={i}>{rich(block.text ?? "")}</p>;
        if (block.type === "note")
          return (
            <aside key={i} className="wiki-note">
              <span className="wiki-note-label">Note</span>
              <p>{rich(block.text ?? "")}</p>
            </aside>
          );
        return (
          <ul key={i} className="wiki-list">
            {block.items?.map((item, j) => {
              const lead = leadIn(item);
              return (
                <li key={j}>
                  {lead && <strong>{lead}</strong>}
                  {rich(lead ? item.slice(lead.length) : item)}
                </li>
              );
            })}
          </ul>
        );
      })}
      <nav className="wiki-pager" aria-label="Previous and next">
        {prev ? (
          <button onClick={() => onOpen(prev.id)}>
            <ArrowLeft size={15} aria-hidden />
            <span>
              <small>Previous</small>
              {prev.title}
            </span>
          </button>
        ) : (
          <span />
        )}
        {next && (
          <button className="next" onClick={() => onOpen(next.id)}>
            <span>
              <small>Next</small>
              {next.title}
            </span>
            <ArrowRight size={15} aria-hidden />
          </button>
        )}
      </nav>
    </article>
  );
}

function FrontPage({ onOpen }: { onOpen: (id: string) => void }) {
  return (
    <div className="wiki-front">
      <div className="wiki-front-head">
        <div className="wiki-kicker">Wiki</div>
        <h1>How the town works</h1>
        <p>What the simulation does, what drives it, and where it simplifies — grouped by subject. Names in a text that link elsewhere are underlined.</p>
      </div>
      <div className="wiki-groups">
        {WIKI_GROUPS.map((g) => {
          const Icon = GROUP_ICON[g.id] ?? Compass;
          return (
            <section key={g.id} className="wiki-group-card">
              <h2>
                <Icon size={17} strokeWidth={1.75} aria-hidden />
                {g.title}
              </h2>
              <p>{g.blurb}</p>
              <ul>
                {g.sections.map((id) => (
                  <li key={id}>
                    <button onClick={() => onOpen(id)}>{SECTION_BY_ID.get(id)?.title}</button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Results({ query, onOpen }: { query: string; onOpen: (id: string) => void }) {
  const q = query.toLowerCase();
  const hits = READING_ORDER.flatMap((id) => {
    const s = SECTION_BY_ID.get(id);
    if (!s) return [];
    const inTitle = s.title.toLowerCase().includes(q);
    const text = s.blocks.map(blockText).join(" ").replace(/"/g, "");
    const at = text.toLowerCase().indexOf(q);
    if (!inTitle && at < 0) return [];
    const snippet = at < 0 ? text.slice(0, 160) : `${at > 60 ? "…" : ""}${text.slice(Math.max(0, at - 60), at + q.length + 100)}…`;
    return [{ s, inTitle, snippet }];
  }).sort((a, b) => Number(b.inTitle) - Number(a.inTitle));
  return (
    <div className="wiki-results">
      <div className="wiki-kicker">Search</div>
      <h1>
        {hits.length} {hits.length === 1 ? "section mentions" : "sections mention"} “{query}”
      </h1>
      <ul>
        {hits.map(({ s, snippet }) => (
          <li key={s.id}>
            <button onClick={() => onOpen(s.id)}>
              <span className="wiki-result-group">{GROUP_OF.get(s.id)?.title}</span>
              <span className="wiki-result-title">{mark(s.title, query)}</span>
              <span className="wiki-result-snippet">{mark(snippet, query)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface WikiPanelProps {
  onClose: () => void;
}

/** The in-game wiki: grouped contents on the left, a front page or one section at a time on the
 * right, and a search across everything. Full screen below the top bar, like the town hall. */
export function WikiPanel({ onClose }: WikiPanelProps) {
  const [sectionId, setSectionId] = useState<string | null>(lastSectionId);
  const [query, setQuery] = useState("");
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const section = sectionId ? (SECTION_BY_ID.get(sectionId) ?? null) : null;
  const trimmed = query.trim();
  const searching = trimmed.length >= 2;

  const open = (id: string | null) => {
    lastSectionId = id;
    setSectionId(id);
    setQuery("");
  };
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [sectionId, searching]);
  // Keep the open section visible in the contents.
  useEffect(() => {
    document.querySelector(".wiki-toc button.active")?.scrollIntoView({ block: "nearest" });
  }, [sectionId]);

  const matching = useMemo(() => {
    if (!searching) return null;
    const q = trimmed.toLowerCase();
    return new Set(WIKI_SECTIONS.filter((s) => s.title.toLowerCase().includes(q) || s.blocks.some((b) => blockText(b).toLowerCase().includes(q))).map((s) => s.id));
  }, [searching, trimmed]);

  return (
    <div className="wiki" role="dialog" aria-label="Wiki">
      <aside className="wiki-nav">
        <div className="wiki-nav-head">
          <button className={`wiki-home${section === null && !searching ? " active" : ""}`} onClick={() => open(null)}>
            Wiki
          </button>
          <button className="wiki-close" onClick={onClose} aria-label="Close the wiki" title="Back to the map (Esc)">
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        <label className="wiki-search">
          <Search size={15} strokeWidth={1.75} aria-hidden />
          <input type="search" placeholder="Search the wiki" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <nav className="wiki-toc" aria-label="Contents">
          {WIKI_GROUPS.map((g) => {
            const Icon = GROUP_ICON[g.id] ?? Compass;
            const ids = matching ? g.sections.filter((id) => matching.has(id)) : g.sections;
            if (ids.length === 0) return null;
            return (
              <div key={g.id} className="wiki-toc-group">
                <h3>
                  <Icon size={14} strokeWidth={1.75} aria-hidden />
                  {g.title}
                </h3>
                <ul>
                  {ids.map((id) => (
                    <li key={id}>
                      <button className={id === sectionId ? "active" : ""} aria-current={id === sectionId ? "page" : undefined} onClick={() => open(id)}>
                        {SECTION_BY_ID.get(id)?.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="wiki-body" ref={bodyRef}>
        {searching ? <Results query={trimmed} onOpen={open} /> : section ? <Article section={section} query="" onOpen={open} /> : <FrontPage onOpen={open} />}
      </div>
    </div>
  );
}
