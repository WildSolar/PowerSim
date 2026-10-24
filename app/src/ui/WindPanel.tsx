import { useState, useSyncExternalStore } from "react";
import { TURBINE_KW, WIND_LOCAL_RADIUS_M, WIND_PERMIT_MONTHS, WIND_STUDY_MONTHS, WIND_ZONING_MONTHS } from "../config/wind";
import { mapFocus } from "../map/mapFocus";
import { approval, votePct } from "../sim/approval";
import { formatDate } from "../sim/calendar";
import { simClock } from "../sim/engine";
import { useSimDay } from "../sim/store";
import { wind, WIND_PHASE_LABEL, type WindPhase, type WindSite } from "../sim/wind";
import { WIND_SITE_COLORS } from "../map/colorModes";
import { ToolListGroup, ToolListRow } from "./ToolList";
import { formatCHF } from "./format";
import "./districtHeatPanel.css";
import "./zoningPanel.css";
import { InspectCard } from "./InspectCard";
import { ToolPanel } from "./ToolPanel";
import { PlotLink } from "./PlotLink";
import { ReactionBadge } from "./ReactionBadge";

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

  return (
    <div>
      <div className="dh-note">
        {WIND_PHASE_LABEL[phase]}
        {p?.phaseUntilMs ? ` · until ${monthYear(p.phaseUntilMs)}` : ""}
      </div>
      <div className="info-row">
        <span>Turbines</span>
        <span className="info-value">
          {n} × {(TURBINE_KW / 1000).toFixed(1)} MW
        </span>
      </div>
      <div className="info-row" title="Mean wind at 125 m (the hub height), from the federal wind atlas, and the year's output it gives">
        <span>Wind · output</span>
        <span className="info-value">
          {meanWind.toFixed(1)} m/s · {gwh.toFixed(1)} GWh a year
        </span>
      </div>
      <div className="info-row" title={`Homes within ${WIND_LOCAL_RADIUS_M / 1000} km of a turbine: they mind most`}>
        <span>Homes within {WIND_LOCAL_RADIUS_M / 1000} km</span>
        <span className="info-value">{homes.near}</span>
      </div>

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
      {phase === "zoning" &&
        (() => {
          const vote = p?.voteKey ? approval.getVoteInfo(p.voteKey, null, now) : null;
          return vote ? <p className="dh-note">Public vote {monthYear(vote.atMs)} · poll {votePct(vote.pollYes)}% yes</p> : null;
        })()}
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
        <details className="wind-log">
          <summary className="dh-note">History</summary>
          {p.log.map((l, i) => (
            <div className="dh-note" key={i}>
              {monthYear(l.atMs)}: {l.text}
            </div>
          ))}
        </details>
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
  const siteRow = (site: WindSite) => {
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
        detail={`${WIND_PHASE_LABEL[phase]}${until}`}
        selected={site.id === selectedId}
        onClick={() => pick(site)}
      />
    );
  };

  const overview = (
    <>
      <p className="dh-note">
        Wind turbines make most of their power in winter, when solar makes least. But in Switzerland the road to one is long: a study, a zoning plan the voters decide
        on, a permit that is almost always appealed, and only then the build. Each step can fail, or take years longer than planned.
      </p>
      {turning > 0 && (
        <div className="info-row">
          <span>Turning</span>
          <span className="info-value">{(turning / 1000).toFixed(1)} MW</span>
        </div>
      )}

      {study === "none" && <p className="dh-note">Nothing is known yet about where turbines could stand: commission a study (Build).</p>}
      {study === "running" && <p className="dh-note">The wind study is under way; results in {monthYear(wind.studyDoneAtMs() ?? now)}.</p>}
      {study === "done" && sites.length === 0 && <p className="dh-note">The study found nowhere a turbine could stand: too close to homes everywhere, or too little wind.</p>}
      {study === "done" && sites.length > 0 && (
        <>
          <ToolListGroup title="Sites the study found">{sites.map(siteRow)}</ToolListGroup>
          <p className="dh-note tool-list-hint">Click a site here or a turbine on the map: its card shows the next step.</p>
        </>
      )}
    </>
  );

  const build = (
    <>
      {study === "none" && (
        <>
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
          <p className="dh-note">Each site goes its own way — a zoning plan the voters decide on, a permit, the build. Pick a site to take its next step:</p>
          <ToolListGroup title="Sites">{sites.map(siteRow)}</ToolListGroup>
        </>
      )}
    </>
  );

  return (
    <ToolPanel mode="wind" title="Wind" titleExtra={<PlotLink chart="electricity" title="Electricity made and used over time" />} overview={overview} build={build} />
  );
}
