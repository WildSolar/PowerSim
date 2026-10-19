import { CheckCheck, ClipboardList, Mail, MapPin, Pin, Vote, X } from "lucide-react";
import type { AdvisorId } from "../sim/advisors";
import { showPickOnMap } from "./openPick";
import { useEffect, useState, useSyncExternalStore } from "react";
import { mapFocus } from "../map/mapFocus";
import { approval, votePct } from "../sim/approval";
import { formatDate } from "../sim/calendar";
import { simClock } from "../sim/engine";
import { INBOX_GROUPS, NOTIFYING_GROUPS, inbox, letterGroup, type InboxGroup, type Letter, type LetterPick } from "../sim/inbox";
import { letters, type LetterRequest } from "../sim/letters";
import { MEASURE_CATALOG } from "../sim/measureCatalog";
import { useSimDay } from "../sim/store";
import { stock } from "../sim/stock";
import "./inbox.css";

export interface InboxSelection {
  tab: InboxGroup;
  id: string | null;
}

const TAB_LABEL: Record<InboxGroup, string> = {
  votes: "Votes",
  requests: "Requests",
  advisors: "Advisors & projects",
  letters: "Letters",
};

const STATUS_LABEL: Record<LetterRequest["status"], string> = {
  open: "Open",
  granted: "Answered",
  resolvedByOthers: "Sorted out by others",
  lapsed: "Lapsed",
};

const MONTH_MS = (365.25 * 24 * 3_600_000) / 12;
// A request this close to its deadline is marked.
const DUE_SOON_MONTHS = 3;

function monthYear(atMs: number): string {
  return formatDate(atMs).replace(/^\d+ /, "");
}

/** Where the inbox opens: the first tab with something unread that calls for attention, else Votes. */
export function defaultInboxTab(nowMs: number): InboxGroup {
  const unread = inbox.unreadCount(nowMs);
  return INBOX_GROUPS.find((g) => NOTIFYING_GROUPS.has(g) && unread[g] > 0) ?? "votes";
}

/** How long a request has left, in words. */
function timeLeft(r: LetterRequest, nowMs: number): string {
  const months = Math.floor((r.deadlineMs - nowMs) / MONTH_MS);
  return months <= 0 ? "under a month left" : `${months} month${months === 1 ? "" : "s"} left`;
}

/** Votes ahead and the next election, with today's poll and approval. */
function Ahead({ nowMs }: { nowMs: number }) {
  const votes = MEASURE_CATALOG.flatMap((d) => {
    const v = approval.getVoteInfo(d.id, d, nowMs);
    return v ? [{ id: d.id, title: d.title, ...v }] : [];
  }).sort((a, b) => a.atMs - b.atMs);
  const election = approval.nextElectionMs();
  const standing = Math.round(approval.getApproval());
  return (
    <li className="inbox-ahead">
      <div className="inbox-ahead-title">Ahead</div>
      {votes.map((v) => (
        <div className="inbox-ahead-row" key={v.id}>
          <span>{v.title}</span>
          <span>
            {monthYear(v.atMs)} · <span className={v.pollYes >= 50 ? "good" : "bad"}>{votePct(v.pollYes)}% yes</span>
          </span>
        </div>
      ))}
      {election !== null && (
        <div className="inbox-ahead-row">
          <span>Election</span>
          <span>
            {monthYear(election)} · <span className={standing >= 50 ? "good" : "bad"}>approval {standing}%</span>
          </span>
        </div>
      )}
      {votes.length === 0 && election === null && <div className="inbox-ahead-row">No vote or election ahead.</div>}
    </li>
  );
}

/** The inbox: votes, requests, the advisors' and the projects' letters (these three call for
 * attention), and every other letter. */
export function InboxPanel({
  initial,
  onClose,
  onSelectBuilding,
  onOpenTool,
  onOpenAdvisor,
}: {
  initial: InboxSelection;
  onClose: () => void;
  onSelectBuilding: (egid: string) => void;
  onOpenTool: (tool: LetterPick["tool"]) => void;
  /** An advisor's letter: open its report in the Town hall. */
  onOpenAdvisor: (id: AdvisorId) => void;
}) {
  useSyncExternalStore(
    (l) => inbox.subscribe(l),
    () => inbox.getVersion(),
  );
  const day = useSimDay(); // requests are checked daily
  const now = simClock.getSimTimeMs();
  const [tab, setTab] = useState<InboxGroup>(initial.tab);
  const [selectedId, setSelectedId] = useState<string | null>(initial.id);

  const allLetters = inbox.getLetters(now);
  const inTab = allLetters.filter((l) => letterGroup(l) === tab);
  const requests = [...letters.getRequests()].filter((r) => r.atMs <= now).sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || a.deadlineMs - b.deadlineMs || b.atMs - a.atMs);
  const unread = inbox.unreadCount(now);

  // Opening a letter marks it read; a tab with nothing chosen opens its newest letter.
  const chosen = allLetters.find((l) => l.id === selectedId && (tab === "requests" ? l.kind === "request" : letterGroup(l) === tab)) ?? null;
  const firstRequestLetter = requests.length > 0 ? (inbox.getLetter(requests[0].letterId) ?? null) : null;
  const selectedLetter = chosen ?? (tab === "requests" ? firstRequestLetter : (inTab[0] ?? null));
  // A request's answer: the follow-up its senders wrote once it was settled.
  const reply = selectedLetter?.kind === "request" ? (allLetters.find((l) => l.kind === "followUp" && l.requestId === selectedLetter.requestId) ?? null) : null;
  useEffect(() => {
    if (selectedLetter) inbox.markRead(selectedLetter.id);
    if (reply) inbox.markRead(reply.id);
  }, [selectedLetter, reply]);
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

  // An advisor's pick: its planning tool opens there — a roof's card, a spot for chargers, or the
  // streets planned as a district heating extension.
  const openPick = (pick: LetterPick) => {
    onClose();
    showPickOnMap(pick, onOpenTool, onSelectBuilding);
  };

  const openRequests = requests.filter((r) => r.status === "open").length;
  const anyUnread = INBOX_GROUPS.some((g) => unread[g] > 0);

  return (
    <div className="inbox-layer">
      <div className="inbox-scrim" onClick={onClose} />
      <aside className="inbox-sheet" role="dialog" aria-label="Inbox">
        <header className="inbox-head">
          <div className="inbox-heading">
            <span className="inbox-kicker">Inbox</span>
            <span className="inbox-running">The game keeps running</span>
          </div>
          <nav className="inbox-tabs" aria-label="Inbox sections">
            {INBOX_GROUPS.map((g) => {
              const count = g === "requests" ? openRequests : unread[g];
              return (
                <button
                  key={g}
                  className={tab === g ? "active" : ""}
                  aria-current={tab === g ? "page" : undefined}
                  onClick={() => {
                    setTab(g);
                    setSelectedId(null);
                  }}
                  title={g === "letters" ? "Everything else: reactions, moods, complaints and news. These never call for your attention." : undefined}
                >
                  {TAB_LABEL[g]}
                  {count > 0 && <span className={`inbox-count${NOTIFYING_GROUPS.has(g) ? "" : " quiet"}`}>{count}</span>}
                </button>
              );
            })}
          </nav>
          <button className="inbox-mark-read" disabled={!anyUnread} onClick={() => inbox.markAllRead(simClock.getSimTimeMs())} title="Mark every letter as read">
            <CheckCheck size={15} strokeWidth={1.75} aria-hidden />
            <span>Mark all read</span>
          </button>
          <button className="inbox-close" onClick={onClose} aria-label="Close the inbox" title="Close (Esc)">
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </header>
        <div className="inbox-body">
          <ul className="inbox-list">
            {tab === "votes" && <Ahead nowMs={now} />}
            {tab === "requests"
              ? requests.map((r) => {
                  const letter = inbox.getLetter(r.letterId);
                  const soon = r.status === "open" && r.deadlineMs - now < DUE_SOON_MONTHS * MONTH_MS;
                  return (
                    <li key={r.id}>
                      <button
                        className={`inbox-item${letter && letter.id === selectedLetter?.id ? " active" : ""}${letter && !inbox.isRead(letter.id) ? " unread" : ""}`}
                        onClick={() => setSelectedId(r.letterId)}
                      >
                        <span className="inbox-item-meta">
                          <span className={`request-status request-${r.status}`}>{STATUS_LABEL[r.status]}</span>
                          <span className={soon ? "request-due-soon" : undefined}>{r.status === "open" ? `by ${monthYear(r.deadlineMs)} · ${timeLeft(r, now)}` : formatDate(r.resolvedAtMs ?? r.atMs)}</span>
                        </span>
                        <span className="inbox-item-subject">{r.ask.charAt(0).toUpperCase() + r.ask.slice(1)}</span>
                      </button>
                    </li>
                  );
                })
              : inTab.map((l) => (
                  <li key={l.id}>
                    <button className={`inbox-item${l.id === selectedLetter?.id ? " active" : ""}${inbox.isRead(l.id) ? "" : " unread"}`} onClick={() => setSelectedId(l.id)}>
                      <span className="inbox-item-meta">
                        <span>{l.from}</span>
                        <span>{formatDate(l.atMs)}</span>
                      </span>
                      <span className="inbox-item-subject">
                        {(l.kind === "voteResult" || l.kind === "voteCalled" || l.kind === "election") && <Vote size={12} strokeWidth={2} aria-hidden />}
                        {l.subject}
                      </span>
                    </button>
                  </li>
                ))}
            {tab === "requests" && requests.length === 0 && <li className="inbox-empty">No one has asked for anything yet.</li>}
            {tab === "votes" && inTab.length === 0 && <li className="inbox-empty">When a measure goes to the ballot, the town clerk writes here — and again with the result.</li>}
            {tab === "advisors" && inTab.length === 0 && <li className="inbox-empty">Reports from the advisors you retain, news of your projects and notices from the canton come here.</li>}
            {tab === "letters" && inTab.length === 0 && <li className="inbox-empty">No letters yet.</li>}
          </ul>
          <div className="inbox-reader">
            {selectedLetter ? (
              <>
                <LetterView letter={selectedLetter} onShowOnMap={showOnMap} onOpenPick={openPick} onOpenAdvisor={onOpenAdvisor} />
                {reply && (
                  <div className="letter-reply">
                    <LetterView letter={reply} onShowOnMap={showOnMap} onOpenPick={openPick} onOpenAdvisor={onOpenAdvisor} />
                  </div>
                )}
              </>
            ) : (
              <p className="inbox-empty">Pick a letter from the list.</p>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function LetterView({
  letter,
  onShowOnMap,
  onOpenPick,
  onOpenAdvisor,
}: {
  letter: Letter;
  onShowOnMap: (focus: { lon: number; lat: number; egid?: string }) => void;
  onOpenPick: (pick: LetterPick) => void;
  onOpenAdvisor: (id: AdvisorId) => void;
}) {
  const request = letter.requestId ? letters.getRequest(letter.requestId) : undefined;
  return (
    <article className="letter">
      <div className="letter-head">
        <div className="letter-from">
          <strong>{letter.from}</strong>
          {letter.role && <span>{letter.role}</span>}
        </div>
        <div className="letter-date">{formatDate(letter.atMs)}</div>
      </div>
      <h2 className="letter-subject">{letter.subject}</h2>
      {letter.paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      {letter.picks && letter.picks.length > 0 && (
        <ol className="letter-picks">
          {letter.picks.map((pick, i) => (
            <li key={i}>
              <button onClick={() => onOpenPick(pick)} title="Open it in its planning tool">
                <span className="letter-pick-label">
                  <MapPin size={13} strokeWidth={1.75} aria-hidden /> {pick.label}
                </span>
                <span className="letter-pick-detail">{pick.detail}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className="letter-sign">— {letter.from}</p>
      {letter.advisor && (
        <button className="letter-map" onClick={() => onOpenAdvisor(letter.advisor as AdvisorId)}>
          <ClipboardList size={15} strokeWidth={1.75} aria-hidden /> Open the report in the Town hall
        </button>
      )}
      {request && letter.kind === "request" && (
        <div className={`letter-request request-${request.status}`}>
          <div className="letter-request-label">
            <Pin size={13} strokeWidth={2} aria-hidden /> Request · {STATUS_LABEL[request.status]}
          </div>
          <div className="letter-request-ask">{request.ask.charAt(0).toUpperCase() + request.ask.slice(1)}</div>
          <div>
            {request.status === "open"
              ? `Open until ${monthYear(request.deadlineMs)}. Answering it in time earns goodwill with the people who asked; letting it lapse costs a little.`
              : `${STATUS_LABEL[request.status]}${request.resolvedAtMs !== undefined ? `, ${monthYear(request.resolvedAtMs)}` : ""}.`}
          </div>
        </div>
      )}
      {letter.focus && (
        <button className="letter-map" onClick={() => onShowOnMap(letter.focus as { lon: number; lat: number; egid?: string })}>
          <MapPin size={15} strokeWidth={1.75} aria-hidden /> {letter.focus.egid ? "Show the building" : "Show on the map"}
        </button>
      )}
    </article>
  );
}

/** A short notice as a letter arrives — only for the groups that call for attention (votes,
 * requests, advisors and projects). */
export function InboxToast({ onOpen }: { onOpen: (selection: InboxSelection) => void }) {
  const [item, setItem] = useState<Letter | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let showingImportant = false;
    const unsubscribe = inbox.onArrival((arrived) => {
      if (!NOTIFYING_GROUPS.has(letterGroup(arrived))) return;
      const important = arrived.kind === "voteResult" || arrived.kind === "election" || arrived.kind === "warning";
      if (showingImportant && !important) return; // a vote result isn't pushed aside by the next letter
      showingImportant = important;
      setItem(arrived);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        showingImportant = false;
        setItem(null);
      }, important ? 15000 : 7000);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);
  if (!item) return null;
  const important = item.kind === "voteResult" || item.kind === "election" || item.kind === "warning";
  return (
    <button
      className={`inbox-toast${important ? " important" : ""}`}
      onClick={() => {
        onOpen({ tab: letterGroup(item), id: item.id });
        setItem(null);
      }}
    >
      {important ? <Vote size={15} strokeWidth={1.75} aria-hidden /> : <Mail size={15} strokeWidth={1.75} aria-hidden />}
      <span className="inbox-toast-text">
        <strong>{item.from}</strong> {item.subject}
      </span>
    </button>
  );
}

/** The inbox button, with how much is unread among what calls for attention. */
export function InboxButton({ onOpen }: { onOpen: () => void }) {
  useSyncExternalStore(
    (l) => inbox.subscribe(l),
    () => inbox.getVersion(),
  );
  useSimDay();
  const total = inbox.unreadNotifying(simClock.getSimTimeMs());
  return (
    <button className="tb-icon-button" onClick={onOpen} title="Inbox: votes, requests, advisors and projects, and letters" data-tour="inbox">
      <Mail size={17} strokeWidth={1.75} aria-hidden />
      <span>Inbox</span>
      {total > 0 ? <span className="inbox-badge">{total}</span> : null}
    </button>
  );
}
