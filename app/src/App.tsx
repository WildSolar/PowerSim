import { useEffect, useMemo, useState } from "react";
import { MapView } from "./map/MapView";
import { BuildingPanel } from "./ui/BuildingPanel";
import { ControlPanel } from "./ui/ControlPanel";
import { DwellingPanel } from "./ui/DwellingPanel";
import { ColorModeControl } from "./ui/ColorModeControl";
import { DistrictHeatPanel } from "./ui/DistrictHeatPanel";
import { EvChargingPanel } from "./ui/EvChargingPanel";
import { ZoningPanel } from "./ui/ZoningPanel";
import { GridPanel } from "./ui/GridPanel";
import { PublicBuildingsPanel } from "./ui/PublicBuildingsPanel";
import { ReportCardModal } from "./ui/ReportCardModal";
import { TimeControl } from "./ui/TimeControl";
import { ApprovalPanel } from "./ui/ApprovalPanel";
import { GameOverModal } from "./ui/GameOverModal";
import { TreasuryPanel } from "./ui/TreasuryPanel";
import { StartMenu } from "./ui/StartMenu";
import { WikiPanel } from "./ui/WikiPanel";
import { loadDataset } from "./data/loadDataset";
import type { MunicipalityDataset } from "./data/types";
import type { ColorMode } from "./map/colorModes";
import { simClock } from "./sim/engine";
import { reportCardStore } from "./sim/reportCardStore";
import { useReportCardYear } from "./sim/store";
import { useTimeKeyboard } from "./ui/useTimeKeyboard";
import { useStockBuildings } from "./ui/useStock";
import { stock } from "./sim/stock";
import { streets } from "./sim/streets";
import { districtHeat } from "./sim/districtHeat";
import { publicCharging } from "./sim/publicCharging";
import { grid } from "./sim/grid";
import { heatPumpSiting } from "./sim/heatPumpSiting";
import { setDistrictHeatLimit } from "./sim/gridLimits";
import { networkFullAt } from "./sim/districtHeatStats";
import { setMeasureAvailability } from "./sim/measureAvailability";
import { studies } from "./sim/studies";
import { municipalSolarCandidates } from "./sim/solarAdoption";
import { zoning } from "./sim/zoning";
import { fleets } from "./sim/fleet";
import { bookInitialPublicCharging } from "./sim/mobility";
import { policyStore } from "./sim/policy";
import { approval } from "./sim/approval";
import { measures } from "./sim/measures";
import { treasury } from "./sim/treasury";
import type { Difficulty } from "./config/difficulty";
import { startYearEndWatcher } from "./sim/yearEndWatcher";
import { startYearPassPrefetch } from "./sim/yearPassPrefetch";
import "./App.css";

// The simulation's state lives in many module-level singletons and caches (policy,
// tariffs, solar adoption, decision log, per-year finances/emissions...), so a page
// reload is the one reliable way to get a clean slate for the next municipality. The
// app always opens on the start menu, so reloading lands there. There's no save
// system yet, so the current run is lost — hence the confirm.
function returnToMenu() {
  if (window.confirm("Return to the main menu? Your current run will be lost.")) {
    window.location.reload();
  }
}

// Dev-only handle for inspecting the simulation from the browser console.
if (import.meta.env.DEV) import("./dev/scenario").then((m) => Object.assign(window, { __scenario: m.runScenario }));
if (import.meta.env.DEV) import("./dev/perf").then((m) => Object.assign(window, { __perf: m.runPerf, __perfYearEnd: m.timeYearEndReport, __perfNewYear: m.timeNewYearPieces, __perfMapTick: m.timeMapPowerTick, __perfRolling: m.timeRollingChart }));
if (import.meta.env.DEV) Object.assign(window, { __debug: { stock, simClock, policyStore, treasury, measures, approval } });

function Game({ slug, difficulty, transparency }: { slug: string; difficulty: Difficulty; transparency: boolean }) {
  const [dataset, setDataset] = useState<MunicipalityDataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedEgid, setSelectedEgid] = useState<string | null>(null);
  const [selectedEwid, setSelectedEwid] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>("none");
  const [showControl, setShowControl] = useState(false);
  const [showWiki, setShowWiki] = useState(false);
  const reportCardYear = useReportCardYear();
  const stockBuildings = useStockBuildings();
  const keyboardEnabled = !showControl && !showWiki && reportCardYear === null;
  useTimeKeyboard(keyboardEnabled);

  // Escape closes whatever is on top: the Year in Review, then the Wiki or the Control window, then a
  // charger being placed, then a dwelling (back to its building), a building, a selected charger,
  // and finally the map layer (back to Default, closing its panel). The game-over screen stays.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (approval.getGameOver()) return;
      if (reportCardYear !== null) reportCardStore.dismiss();
      else if (showWiki) setShowWiki(false);
      else if (showControl) setShowControl(false);
      else if (publicCharging.getPlacing()) publicCharging.startPlacing(null);
      else if (selectedEwid !== null) setSelectedEwid(null);
      else if (selectedEgid !== null) setSelectedEgid(null);
      else if (publicCharging.getSelectedId() !== null) publicCharging.select(null);
      else if (colorMode !== "none") setColorMode("none");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [reportCardYear, showWiki, showControl, selectedEwid, selectedEgid, colorMode]);

  useEffect(() => {
    simClock.start();
    const stopWatcher = startYearEndWatcher();
    return () => {
      simClock.stop();
      stopWatcher();
    };
  }, []);

  useEffect(() => {
    loadDataset(`/data/${slug}.json`)
      .then((loaded) => {
        measures.init(difficulty); // before the stock: it registers the town size the measures' costs scale with
        approval.init(difficulty, `approval:${loaded.bfsNumber}`);
        studies.init(`studies:${loaded.bfsNumber}`);
        streets.init(loaded); // before the stock: new buildings are linked to their street, and to the district heating network
        districtHeat.init(loaded);
        zoning.init(loaded); // before the stock: new buildings ask their parcel what it allows
        heatPumpSiting.init(loaded, () => stock.getAll()); // before the stock: heating decisions ask it where a heat pump may go
        publicCharging.init(loaded, 0);
        publicCharging.setBuildingLookup((egid) => stock.lookup(egid));
        publicCharging.setBuildingsProvider(() => stock.getAll());
        fleets.init(loaded, (egid) => stock.lookup(egid)); // before the stock: it commits their decisions
        stock.init(loaded);
        // The public-building programmes have nothing left to do once every building they could reach has it.
        setMeasureAvailability("municipal-solar", (atMs) =>
          municipalSolarCandidates(stock.getAll(), loaded.powerPlants, atMs).length === 0 ? "Every public building with a roof for it already has solar." : null,
        );
        setMeasureAvailability("public-building-chargers", (atMs) =>
          publicCharging.publicBuildingChargerCandidates(atMs).length === 0 ? "Every public building (campus) already has chargers." : null,
        );
        bookInitialPublicCharging(stock.getAll()); // after the stock: it needs every building
        grid.init(loaded, () => stock.getAll()); // last: it reads every building's draw, public chargers included
        setDistrictHeatLimit((atMs) => networkFullAt(stock.getAll(), atMs));
        setDataset(loaded);
      })
      .catch((e: Error) => setError(e.message));
  }, [slug, difficulty]);

  // Samples each finished month for the year-end report in the background, so the report opens fast.
  useEffect(() => (dataset ? startYearPassPrefetch(dataset.powerPlants) : undefined), [dataset]);

  // The dataset as it stands now: the base buildings plus everything built since (sim/stock.ts).
  // MapView keeps the original dataset (its mount is keyed on that reference) and reads the stock itself.
  const liveDataset = useMemo(() => (dataset ? { ...dataset, buildings: stockBuildings } : null), [dataset, stockBuildings]);

  const selectedBuilding = useMemo(
    () => stockBuildings.find((b) => b.egid === selectedEgid) ?? null,
    [stockBuildings, selectedEgid],
  );
  const selectedDwelling = useMemo(
    () => selectedBuilding?.dwellings.find((d) => d.ewid === selectedEwid) ?? null,
    [selectedBuilding, selectedEwid],
  );

  if (error) {
    return <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>Failed to load dataset: {error}</div>;
  }
  if (!dataset) {
    return <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>Loading…</div>;
  }

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <MapView
        dataset={dataset}
        selectedEgid={selectedEgid}
        onSelectBuilding={(egid) => {
          setSelectedEgid(egid);
          setSelectedEwid(null);
        }}
        colorMode={colorMode}
        keyboardEnabled={keyboardEnabled}
      />
      <div className="top-left-stack">
        <TimeControl />
        <TreasuryPanel dataset={liveDataset ?? dataset} />
        <ApprovalPanel />
        <ColorModeControl mode={colorMode} onChange={setColorMode} />
      </div>
      {colorMode === "districtHeat" && <DistrictHeatPanel />}
      {colorMode === "evCharging" && <EvChargingPanel />}
      {colorMode === "zoning" && <ZoningPanel />}
      {colorMode === "grid" && <GridPanel />}
      {colorMode === "publicBuildings" && (
        <PublicBuildingsPanel
          buildings={stockBuildings}
          realPlants={dataset.powerPlants}
          selectedEgid={selectedEgid}
          onSelectBuilding={(egid) => {
            setSelectedEgid(egid);
            setSelectedEwid(null);
          }}
        />
      )}
      <div className="bottom-left-stack">
        <button className="pill-button" onClick={() => setShowControl(true)}>
          ⚙️ {dataset.name} Control
        </button>
        <button className="pill-button" onClick={() => setShowWiki(true)}>
          📖 Wiki
        </button>
        <button className="pill-button" onClick={returnToMenu}>
          ☰ Main menu
        </button>
      </div>
      <GameOverModal />
      {showControl && <ControlPanel dataset={liveDataset ?? dataset} transparency={transparency} onClose={() => setShowControl(false)} />}
      {showWiki && <WikiPanel onClose={() => setShowWiki(false)} />}
      {reportCardYear !== null && (
        <ReportCardModal dataset={liveDataset ?? dataset} year={reportCardYear} onClose={() => reportCardStore.dismiss()} />
      )}
      {selectedDwelling && selectedBuilding ? (
        <DwellingPanel
          building={selectedBuilding}
          dwelling={selectedDwelling}
          allBuildings={stockBuildings}
          realPlants={dataset.powerPlants}
          onBack={() => setSelectedEwid(null)}
          onClose={() => {
            setSelectedEgid(null);
            setSelectedEwid(null);
          }}
        />
      ) : selectedBuilding ? (
        <BuildingPanel
          building={selectedBuilding}
          allBuildings={stockBuildings}
          realPlants={dataset.powerPlants}
          onSelectDwelling={setSelectedEwid}
          onClose={() => setSelectedEgid(null)}
        />
      ) : null}
    </div>
  );
}

export default function App() {
  const [choice, setChoice] = useState<{ slug: string; difficulty: Difficulty; transparency: boolean } | null>(null);
  return choice ? (
    <Game slug={choice.slug} difficulty={choice.difficulty} transparency={choice.transparency} />
  ) : (
    <StartMenu onStart={(slug, difficulty, transparency) => setChoice({ slug, difficulty, transparency })} />
  );
}
