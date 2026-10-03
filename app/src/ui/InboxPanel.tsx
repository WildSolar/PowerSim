import { Mail } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { mapFocus } from "../map/mapFocus";
import { formatDate } from "../sim/calendar";
import { simClock } from "../sim/engine";
import { inbox, type Edition, type Letter } from "../sim/inbox";
import { letters, type LetterRequest } from "../sim/letters";
import { useSimDay } from "../sim/store";
import { stock } from "../sim/stock";
import "./modal.css";
import "./inbox.css";

type Tab = "letters" | "requests" | "paper";

export interface InboxSelection {
  tab: Tab;
  id: string | null;
}

const STATUS_LABEL: Record<LetterRequest["status"], string> = {
  open: "Open",
  granted: "Answered",
  resolvedByOthers: "Sorted out by others",
  lapsed: "Lapsed",
};

function monthYear(atMs: number): string {
  return formatDate(atMs).replace(/^\d+ /, "");
}

/** Letters from residents and groups, the requests among them, and the local paper. */
export function InboxPanel({ initial, onClose, onSelectBuilding }: { initial: InboxSelection; onClose: () => void; onSelectBuilding: (egid: string) => void }) {
  useSyncExternalStore(
    (l) => inbox.subscribe(l),
    () => inbox.getVersion(),
  );
  const day = useSimDay(); // requests are checked daily
  const now = simClock.getSimTimeMs();
  const [tab, setTab] = useState<Tab>(initial.tab);
  const [selectedId, setSelectedId] = useState<string | null>(initial.id);

  const allLetters = inbox.getLetters(now);
  const editions = inbox.getEditions(now);
  const requests = [...letters.getRequests()].filter((r) => r.atMs <= now).sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || b.atMs - a.atMs);
  const unread = inbox.unreadCount(now);

  // Opening an item marks it read; a tab with nothing chosen opens its newest item.
  const selectedLetter = tab !== "paper" ? (allLetters.find((l) => l.id === selectedId) ?? null) : null;
  const selectedEdition = tab === "paper" ? (editions.find((e) => e.id === selectedId) ?? editions[0] ?? null) : null;
  useEffect(() => {
    if (selectedLetter) inbox.markRead(selectedLetter.id);
    if (selectedEdition) inbox.markRead(selectedEdition.id);
  }, [selectedLetter, selectedEdition]);
  void day;

  // A letter about a building selects it (its panel opens) and centres it; one about a place centres that.
  const showOnMap = (focus: { lon: number; lat: number; egid?: string }) => {
    const building = focus.egid ? stock.lookup(focus.egid) : undefined;
    onClose();
    if (building) {
      onSelectBuilding(building.egid);
      mapFocus.focusBuilding(building, 17);
    } else {
      mapFocus.request({ lon: focus.lon, lat: focus.lat, minZoom: 16 });
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-shell inbox-shell" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <nav className="modal-nav inbox-nav">
          <div className="inbox-tabs">
            <button className={tab === "letters" ? "active" : ""} onClick={() => setTab("letters")}>
              Letters{unread.letters > 0 ? ` (${unread.letters})` : ""}
            </button>
            <button className={tab === "requests" ? "active" : ""} onClick={() => setTab("requests")}>
              Requests{requests.some((r) => r.status === "open") ? ` (${requests.filter((r) => r.status === "open").length})` : ""}
            </button>
            <button className={tab === "paper" ? "active" : ""} onClick={() => setTab("paper")}>
              Paper{unread.editions > 0 ? ` (${unread.editions})` : ""}
            </button>
          </div>
          <ul>
            {tab === "letters" &&
              allLetters.map((l) => (
                <li key={l.id}>
                  <button className={`inbox-item${l.id === selectedLetter?.id ? " active" : ""}${inbox.isRead(l.id) ? "" : " unread"}`} onClick={() => setSelectedId(l.id)}>
                    <span className="inbox-item-subject">
                      {l.requestId && l.kind === "request" ? "📌 " : ""}
                      {l.subject}
                    </span>
                    <span className="inbox-item-meta">
                      {l.from} · {formatDate(l.atMs)}
                    </span>
                  </button>
                </li>
              ))}
            {tab === "requests" &&
              requests.map((r) => {
                const letter = inbox.getLetter(r.letterId);
                return (
                  <li key={r.id}>
                    <button className={`inbox-item${letter && letter.id === selectedLetter?.id ? " active" : ""}`} onClick={() => setSelectedId(r.letterId)}>
                      <span className="inbox-item-subject">{r.ask.charAt(0).toUpperCase() + r.ask.slice(1)}</span>
                      <span className={`inbox-item-meta request-${r.status}`}>
                        {STATUS_LABEL[r.status]}
                        {r.status === "open" ? ` · by ${monthYear(r.deadlineMs)}` : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            {tab === "paper" &&
              editions.map((e) => (
                <li key={e.id}>
                  <button className={`inbox-item${e.id === selectedEdition?.id ? " active" : ""}${inbox.isRead(e.id) ? "" : " unread"}`} onClick={() => setSelectedId(e.id)}>
                    <span className="inbox-item-subject">{e.lead.headline}</span>
                    <span className="inbox-item-meta">{e.dateLabel}</span>
                  </button>
                </li>
              ))}
            {tab === "letters" && allLetters.length === 0 && <li className="inbox-empty">No letters yet.</li>}
            {tab === "requests" && requests.length === 0 && <li className="inbox-empty">No one has asked for anything yet.</li>}
            {tab === "paper" && editions.length === 0 && <li className="inbox-empty">The first edition comes out at the start of next month.</li>}
          </ul>
        </nav>
        <div className="modal-content inbox-content">
          {tab === "paper" ? (
            selectedEdition ? (
              <EditionView edition={selectedEdition} />
            ) : (
              <p className="inbox-empty">No edition yet.</p>
            )
          ) : selectedLetter ? (
            <LetterView letter={selectedLetter} onShowOnMap={showOnMap} />
          ) : (
            <p className="inbox-empty">Pick a letter on the left.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function LetterView({ letter, onShowOnMap }: { letter: Letter; onShowOnMap: (focus: { lon: number; lat: number; egid?: string }) => void }) {
  const request = letter.requestId ? letters.getRequest(letter.requestId) : undefined;
  return (
    <article className="letter">
      <div className="letter-head">
        <div className="letter-from">
          <strong>{letter.from}</strong>
          {letter.role && <span>, {letter.role}</span>}
        </div>
        <div className="letter-date">{formatDate(letter.atMs)}</div>
      </div>
      <h2 className="letter-subject">{letter.subject}</h2>
      {letter.paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      <p className="letter-sign">— {letter.from}</p>
      {request && letter.kind === "request" && (
        <div className={`letter-request request-${request.status}`}>
          <div>
            <strong>Request:</strong> {request.ask}
          </div>
          <div>
            {request.status === "open"
              ? `Open until ${monthYear(request.deadlineMs)}. Answering it in time earns goodwill with the people who asked; letting it lapse costs a little.`
              : `${STATUS_LABEL[request.status]}${request.resolvedAtMs !== undefined ? `, ${monthYear(request.resolvedAtMs)}` : ""}.`}
          </div>
        </div>
      )}
      {letter.focus && (
        <button className="letter-map" onClick={() => onShowOnMap(letter.focus as { lon: number; lat: number; egid?: string })}>
          📍 {letter.focus.egid ? "Show the building" : "Show on the map"}
        </button>
      )}
    </article>
  );
}

function EditionView({ edition }: { edition: Edition }) {
  return (
    <article className="paper">
      <div className="paper-masthead">
        <span className="paper-title">{edition.title}</span>
        <span className="paper-date">{edition.dateLabel}</span>
      </div>
      <h1 className="paper-lead">{edition.lead.headline}</h1>
      <p className="paper-lead-body">{edition.lead.body}</p>
      <div className="paper-stories">
        {edition.stories.map((s, i) => (
          <section key={i} className="paper-story">
            <h3>{s.headline}</h3>
            <p>{s.body}</p>
          </section>
        ))}
      </div>
      <div className="paper-editorial">
        <strong>From the editor.</strong> {edition.editorial}
      </div>
    </article>
  );
}

/** A short notice when a letter or an edition arrives; clicking it opens the inbox there. */
export function InboxToast({ onOpen }: { onOpen: (selection: InboxSelection) => void }) {
  const [item, setItem] = useState<Letter | Edition | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = inbox.onArrival((arrived) => {
      setItem(arrived);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setItem(null), 7000);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);
  if (!item) return null;
  const isEdition = "lead" in item;
  return (
    <button
      className="inbox-toast"
      onClick={() => {
        onOpen({ tab: isEdition ? "paper" : "letters", id: item.id });
        setItem(null);
      }}
    >
      {isEdition ? (
        <>
          📰 <strong>{item.title}:</strong> {item.lead.headline}
        </>
      ) : (
        <>
          ✉️ <strong>{item.from}:</strong> {item.subject}
        </>
      )}
    </button>
  );
}

/** The inbox button, with how much is unread. */
export function InboxButton({ onOpen }: { onOpen: () => void }) {
  useSyncExternalStore(
    (l) => inbox.subscribe(l),
    () => inbox.getVersion(),
  );
  useSimDay();
  const unread = inbox.unreadCount(simClock.getSimTimeMs());
  const total = unread.letters + unread.editions;
  return (
    <button className="tb-icon-button" onClick={onOpen} title="Letters and the local paper">
      <Mail size={17} strokeWidth={1.75} aria-hidden />
      <span>Inbox</span>
      {total > 0 ? <span className="inbox-badge">{total}</span> : null}
    </button>
  );
}
