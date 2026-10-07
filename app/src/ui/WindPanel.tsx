import { useState, useSyncExternalStore } from "react";
import { TURBINE_KW, WIND_LOCAL_RADIUS_M, WIND_PERMIT_MONTHS, WIND_STUDY_MONTHS, WIND_ZONING_MONTHS } from "../config/wind";
import { mapFocus } from "../map/mapFocus";
import { approval } from "../sim/approval";
import { formatDate } from "../sim/calendar";
import { simClock } from "../sim/engine";
import { useSimDay } from "../sim/store";
import { wind, WIND_PHASE_LABEL, type WindSite } from "../sim/wind";
import { formatCHF } from "./format";
import "./districtHeatPanel.css";
import "./zoningPanel.css";
import { SupervisionNotice } from "./SupervisionNotice";

function monthYear(ms: number): string {
  return formatDate(ms).replace(/^\d+ /, "");
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
    <div className="dh-network">
      <button className="dh-link" style={{ fontWeight: 600 }} onClick={() => mapFocus.request({ lon: site.lon, lat: site.lat, minZoom: 14.5 })}>
        {site.name ?? site.id}
      </button>
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
            <span className={`zn-reaction ${reaction.tone}`}>{reaction.label}</span>
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
          return vote ? <p className="dh-note">Public vote {monthYear(vote.atMs)} · poll {Math.round(vote.pollYes)}% yes</p> : null;
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

  return (
    <div className="district-heat-panel">
      <h3 className="panel-title">Wind</h3>
      <SupervisionNotice />
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
      {study === "done" && sites.length === 0 && <p className="dh-note">The study found nowhere a turbine could stand: too close to homes everywhere, or too little wind.</p>}
      {study === "done" && sites.length > 0 && (
        <>
          <h4 className="dh-subtitle">Sites the study found</h4>
          {sites.map((s) => (
            <SiteCard key={s.id} site={s} now={now} />
          ))}
        </>
      )}
    </div>
  );
}
