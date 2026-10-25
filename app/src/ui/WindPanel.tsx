import { useState, useSyncExternalStore } from "react";
import { TURBINE_KW, WIND_LOCAL_RADIUS_M, WIND_PERMIT_MONTHS, WIND_STUDY_MONTHS, WIND_ZONING_MONTHS } from "../config/wind";
import { mapFocus } from "../map/mapFocus";
import { approval, votePct } from "../sim/approval";
import { formatDate } from "../sim/calendar";
import { simClock } from "../sim/engine";
import { useSimDay } from "../sim/store";
import { wind, WIND_PHASE_LABEL, type WindPhase, type WindSite } from "../sim/wind";
import { WIND_SITE_COLORS } from "../map/colorModes";
import { ToolListGroup, ToolListRow, ToolTile } from "./ToolList";
import { formatCHF } from "./format";
import "./districtHeatPanel.css";
import "./zoningPanel.css";
import { InspectCard } from "./InspectCard";
import { ToolPanel } from "./ToolPanel";
import { PlotLink } from "./PlotLink";
import { ReactionBadge } from "./ReactionBadge";
import { CardKind, Facts, Folded } from "./CardParts";

function monthYear(ms: number): string {
  return formatDate(ms).replace(/^\d+ /, "");
}

/** The card for the wind site picked on the map or in a list: its turbines, wind and neighbours,
 * where it stands, and its next step. */
export function WindSiteCard() {
  useSyncExternalStore(
    (l) => wind.subscribe(l),
    () => wind.getVersion(),
  );
  const now = useSimDay();
  const id = wind.getSelectedId();
  const site = id ? wind.sitesAt(now).find((s) => s.id === id) : undefined;
  if (!site) return null;
  return (
    <InspectCard kicker="Wind site" title={site.name ?? site.id} onClose={() => wind.select(null)}>
      <SiteCard site={site} now={now} />
    </InspectCard>
  );
}

function SiteCard({ site, now }: { site: WindSite; now: number }) {
  const p = wind.project(site.id);
  const phase = wind.phaseOf(site.id);
  const [turbines, setTurbines] = useState(site.turbines.length);
  const n = p?.turbines ?? turbines;
  const gwh = wind.yearlyKWh(site, n) / 1e6;
  const homes = wind.homesNear(site, n, now);
  const meanWind = site.turbines.slice(0, n).reduce((s, t) => s + t.vMean, 0) / Math.max(1, n);
  const stances = wind.stancesFor(site, n, now);
  const reaction = approval.reactionTo(stances);
  const canRestart = (phase === "rejected" || phase === "struckDown") && wind.canStartZoning(site.id, now);

  const vote = phase === "zoning" && p?.voteKey ? approval.getVoteInfo(p.voteKey, null, now) : null;
  const actions = phase === "found" || canRestart || phase === "zoning" || phase === "zoned" || phase === "permitted" || phase === "rejected" || phase === "struckDown";
  return (
    <div>
      <CardKind>
        {WIND_PHASE_LABEL[phase]}
        {p?.phaseUntilMs ? ` · until ${monthYear(p.phaseUntilMs)}` : ""}
      </CardKind>
      <Facts
        facts={[
          { label: "Turbines", value: `${n} × ${(TURBINE_KW / 1000).toFixed(1)} MW` },
          {
            label: "Wind · output",
            value: (
              <>
                {meanWind.toFixed(1)} m/s<span className="bp-sub"> · {gwh.toFixed(1)} GWh a year</span>
              </>
            ),
            title: "Mean wind at 125 m (the hub height), from the federal wind atlas, and the year's output it gives",
          },
          { label: `Homes within ${WIND_LOCAL_RADIUS_M / 1000} km`, value: homes.near, title: `Homes within ${WIND_LOCAL_RADIUS_M / 1000} km of a turbine: they mind most` },
        ]}
      />

      {actions && <h3 className="section-heading">What could change here</h3>}
      {(phase === "found" || canRestart) && (
        <>
          {site.turbines.length > 1 && (
            <label className="dh-size">
              <span>
                Plan for <strong>{turbines}</strong> turbine{turbines === 1 ? "" : "s"}
              </span>
              <input type="range" min={1} max={site.turbines.length} step={1} value={turbines} onChange={(e) => setTurbines(Number(e.target.value))} />
            </label>
          )}
          <div className="info-row">
            <span>Public reaction</span>
            <span className="zn-reaction">
              <ReactionBadge reaction={reaction} />
            </span>
          </div>
          <p className="dh-note">
            A zoning plan takes {WIND_ZONING_MONTHS} months and always goes to a public vote. Then a permit ({WIND_PERMIT_MONTHS} months, likely appealed), then the build.
          </p>
          <div className="dh-actions">
            <button className="dh-order" onClick={() => wind.startZoning(site.id, turbines, simClock.getSimTimeMs())}>
              Put a zoning plan forward for {formatCHF(wind.zoningCostRp(turbines))}
            </button>
          </div>
        </>
      )}
      {phase === "zoning" && <p className="dh-note">{vote ? `Public vote ${monthYear(vote.atMs)} · poll ${votePct(vote.pollYes)}% yes.` : "The zoning plan is on its way."}</p>}
      {phase === "zoned" && (
        <div className="dh-actions">
          <button className="dh-order" onClick={() => wind.applyForPermit(site.id, simClock.getSimTimeMs())}>
            Apply for the permit — {formatCHF(wind.permitCostRp())}
          </button>
        </div>
      )}
      {phase === "permitted" && (
        <>
          <p className="dh-note">Build cost after the federal contribution; the turbines turn a year after ordering.</p>
          <div className="dh-actions">
            <button className="dh-order" onClick={() => wind.build(site.id, simClock.getSimTimeMs())}>
              Build for {formatCHF(wind.buildCostRp(n, now))}
            </button>
          </div>
        </>
      )}
      {(phase === "rejected" || phase === "struckDown") && !canRestart && p && (
        <p className="dh-note">Can be taken up again from {monthYear(p.phaseFromMs + 4 * 365.25 * 24 * 3_600_000)}.</p>
      )}
      {p && p.log.length > 0 && (
        <Folded summary={`What happened here (${p.log.length})`}>
          {p.log.map((l, i) => (
            <div className="dh-note" key={i}>
              {monthYear(l.atMs)}: {l.text}
            </div>
          ))}
        </Folded>
      )}
    </div>
  );
}

/** A site's colour on the map, by how far it has come (as MapView.tsx draws its turbines). */
function phaseBucket(phase: WindPhase): keyof typeof WIND_SITE_COLORS {
  if (phase === "operating") return "turning";
  if (phase === "permitted" || phase === "building") return "ready";
  if (phase === "rejected" || phase === "struckDown") return "stopped";
  if (phase === "found") return "planned";
  return "underWay";
}

/** The wind layer's panel: the study, then each site the study found, step by step. */
export function WindPanel() {
  useSyncExternalStore(
    (l) => wind.subscribe(l),
    () => wind.getVersion(),
  );
  const now = useSimDay();
  const study = wind.studyState(now);
  const sites = wind.sitesAt(now);
  const turning = wind.capacityAtKw(now);

  const selectedId = wind.getSelectedId();
  const pick = (site: WindSite) => {
    wind.select(site.id);
    mapFocus.request({ lon: site.lon, lat: site.lat, minZoom: 14.5 });
  };
  const siteRow = (site: WindSite, detailOverride?: string) => {
    const p = wind.project(site.id);
    const phase = wind.phaseOf(site.id);
    const n = p?.turbines ?? site.turbines.length;
    const until = p?.phaseUntilMs && phase !== "operating" ? ` · until ${monthYear(p.phaseUntilMs)}` : "";
    return (
      <ToolListRow
        key={site.id}
        color={WIND_SITE_COLORS[phaseBucket(phase)]}
        title={site.name ?? site.id}
        figure={`${n} turbine${n === 1 ? "" : "s"} · ${(wind.yearlyKWh(site, n) / 1e6).toFixed(0)} GWh a year`}
        detail={detailOverride ?? `${WIND_PHASE_LABEL[phase]}${until}`}
        selected={site.id === selectedId}
        onClick={() => pick(site)}
      />
    );
  };

  const byBucket = (bucket: ReturnType<typeof phaseBucket>) => sites.filter((s) => phaseBucket(wind.phaseOf(s.id)) === bucket);
  const turbinesTurning = byBucket("turning").reduce((sum, s) => sum + (wind.project(s.id)?.turbines ?? 0), 0);
  const potentialGWh = sites.reduce((sum, s) => sum + wind.yearlyKWh(s, s.turbines.length), 0) / 1e6;
  const underWay = byBucket("underWay").length + byBucket("ready").filter((s) => wind.phaseOf(s.id) === "building").length;
  const vote = (site: WindSite) => {
    const key = wind.project(site.id)?.voteKey;
    return wind.phaseOf(site.id) === "zoning" && key ? approval.getVoteInfo(key, null, now) : null;
  };
  // What waits on the player: a permit to apply for, a permitted site to build, a stopped one free to
  // try again — and a vote coming up.
  const needsYou = sites
    .map((site) => {
      const phase = wind.phaseOf(site.id);
      const v = vote(site);
      const detail =
        phase === "zoned"
          ? "Zoned — apply for the permit on its card"
          : phase === "permitted"
            ? "Permitted — order the build on its card"
            : (phase === "rejected" || phase === "struckDown") && wind.canStartZoning(site.id, now)
              ? `${WIND_PHASE_LABEL[phase]} — may be put forward again`
              : v
                ? `To the vote ${monthYear(v.atMs)} · ${votePct(v.pollYes)}% yes in the polls`
                : null;
      return detail ? siteRow(site, detail) : null;
    })
    .filter((r) => r !== null);

  const overview = (
    <>
      {(study !== "done" || sites.every((s) => wind.phaseOf(s.id) === "found")) && (
        <p className="dh-note">
          Wind turbines make most of their power in winter, when solar makes least. But in Switzerland the road to one is long: a study, a zoning plan the voters decide
          on, a permit that is almost always appealed, and only then the build. Each step can fail, or take years longer than planned.
        </p>
      )}
      {study === "none" && <p className="dh-note">Nothing is known yet about where turbines could stand: commission a study (Build).</p>}
      {study === "running" && <p className="dh-note">The wind study is under way; results in {monthYear(wind.studyDoneAtMs() ?? now)}.</p>}
      {study === "done" && sites.length === 0 && <p className="dh-note">The study found nowhere a turbine could stand: too close to homes everywhere, or too little wind.</p>}
      {study === "done" && sites.length > 0 && (
        <>
          <div className="tool-tiles">
            <ToolTile
              label="Turning"
              value={`${(turning / 1000).toFixed(1)} MW`}
              sub={`${turbinesTurning} turbine${turbinesTurning === 1 ? "" : "s"}`}
              title={`Wind turbines in service, ${TURBINE_KW / 1000} MW each`}
            />
            <ToolTile
              label="Under way"
              value={String(underWay)}
              sub={`${byBucket("ready").length} permitted or being built`}
              title="Sites on their way: the zoning plan and its vote, the permit and the courts, the build"
            />
            <ToolTile
              label="Sites found"
              value={String(sites.length)}
              sub={`up to ${potentialGWh.toFixed(0)} GWh a year`}
              title="Where the wind study found turbines could stand, and what they'd make a year with every turbine the site could take"
            />
            <ToolTile
              label="Stopped"
              value={String(byBucket("stopped").length)}
              sub="voted down or struck down"
              title="Sites voted down or struck down in court. After a few years at rest, a site may be put forward again."
            />
          </div>

          <ToolListGroup title="Needs you" limit={4}>
            {needsYou}
          </ToolListGroup>
          <ToolListGroup title="Turning" limit={3}>
            {byBucket("turning").map((s) => siteRow(s))}
          </ToolListGroup>
          <ToolListGroup title="Permitted or being built" limit={3}>
            {byBucket("ready").map((s) => siteRow(s))}
          </ToolListGroup>
          <ToolListGroup title="Zoning or permit under way" limit={3}>
            {byBucket("underWay").map((s) => siteRow(s))}
          </ToolListGroup>
          <ToolListGroup title="Found, nothing done yet" limit={4}>
            {byBucket("planned").map((s) => siteRow(s))}
          </ToolListGroup>
          <ToolListGroup title="Voted down or struck down" limit={0}>
            {byBucket("stopped").map((s) => siteRow(s))}
          </ToolListGroup>
          <p className="dh-note tool-list-hint">Click a site here or a turbine on the map: its card shows the next step.</p>
        </>
      )}
    </>
  );

  const build = (
    <>
      {study === "none" && (
        <>
          <h4 className="tool-list-heading">Find the sites</h4>
          <p className="dh-note">Nothing is known yet about where turbines could stand. A study takes {WIND_STUDY_MONTHS} months: wind measurements and a site assessment.</p>
          <div className="dh-actions">
            <button className="dh-order" onClick={() => wind.orderStudy(simClock.getSimTimeMs())}>
              Commission a wind study — {formatCHF(wind.studyCostRp(now))}
            </button>
          </div>
        </>
      )}
      {study === "running" && <p className="dh-note">The wind study is under way; results in {monthYear(wind.studyDoneAtMs() ?? now)}.</p>}
      {study === "done" && sites.length === 0 && <p className="dh-note">The study found nowhere a turbine could stand.</p>}
      {study === "done" && sites.length > 0 && (
        <>
          <ToolListGroup title="Next steps" limit={6}>
            {needsYou}
          </ToolListGroup>
          <ToolListGroup title="Found — put a zoning plan forward" limit={6}>
            {byBucket("planned").map((s) => siteRow(s, `${s.turbines.length} turbine${s.turbines.length === 1 ? "" : "s"} at most · the plan goes to the vote`))}
          </ToolListGroup>
          <p className="dh-note tool-list-hint">
            Each site goes its own way — a zoning plan the voters decide on ({WIND_ZONING_MONTHS} months), a permit ({WIND_PERMIT_MONTHS} months, often appealed), the build.
            Pick a site: its card takes the next step.
          </p>
        </>
      )}
    </>
  );

  return (
    <ToolPanel mode="wind" title="Wind" titleExtra={<PlotLink chart="electricity" title="Electricity made and used over time" />} overview={overview} build={build} />
  );
}
