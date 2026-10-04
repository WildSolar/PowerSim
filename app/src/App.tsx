import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { MapView } from "./map/MapView";
import { BuildingPanel } from "./ui/BuildingPanel";
import { TownHall, type TownHallSection } from "./ui/TownHall";
import { TariffDeadlineDialog, useTariffDeadline } from "./ui/TariffDeadlineDialog";
import { tariffDeadline } from "./sim/tariffDeadline";
import { DwellingPanel } from "./ui/DwellingPanel";
import { LayerDock, isToolLayer, layerLabel } from "./ui/LayerDock";
import { LayerLegend } from "./ui/LayerLegend";
import { TopBar } from "./ui/TopBar";
import { DistrictHeatPanel } from "./ui/DistrictHeatPanel";
import { EvChargingPanel } from "./ui/EvChargingPanel";
import { ZoningPanel } from "./ui/ZoningPanel";
import { GridPanel } from "./ui/GridPanel";
import { PublicBuildingsPanel } from "./ui/PublicBuildingsPanel";
import { ReportCardModal } from "./ui/ReportCardModal";
import { EndScreen } from "./ui/EndScreen";
import { loadPar } from "./sim/par";
import { NET_ZERO_TARGET_YEAR } from "./sim/score";
import { StartMenu } from "./ui/StartMenu";
import { WikiPanel } from "./ui/WikiPanel";
import { GameMenu } from "./ui/GameMenu";
import { applySave, captureSave, stateJson, type SaveFile } from "./sim/saveGame";
import { AUTOSAVE_ID, putSave } from "./sim/saveStore";
import { dataUrl, loadDataset } from "./data/loadDataset";
import type { MunicipalityDataset } from "./data/types";
import type { ColorMode } from "./map/colorModes";
import { simClock } from "./sim/engine";
import { setEpoch } from "./sim/calendar";
import { reportCardStore } from "./sim/reportCardStore";
import { useReportCardYear } from "./sim/store";
import { useTimeKeyboard } from "./ui/useTimeKeyboard";
import { useStockBuildings } from "./ui/useStock";
import { stock } from "./sim/stock";
import { streets } from "./sim/streets";
import { districtHeat } from "./sim/districtHeat";
import { publicCharging } from "./sim/publicCharging";
import { grid } from "./sim/grid";
import { inbox } from "./sim/inbox";
import { debt } from "./sim/debt";
import { letters } from "./sim/letters";
import { newspaper } from "./sim/newspaper";
import { InboxPanel, InboxToast, type InboxSelection } from "./ui/InboxPanel";
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
import { market } from "./sim/market";
import { dynamicTariff } from "./sim/dynamicTariff";
import { initTariffApproval } from "./sim/tariffApproval";
import { tariffStore } from "./sim/tariffStore";
import { measures } from "./sim/measures";
import { treasury } from "./sim/treasury";
import type { Difficulty } from "./config/difficulty";
import { startYearEndWatcher } from "./sim/yearEndWatcher";
import { startYearPassPrefetch } from "./sim/yearPassPrefetch";

// The simulation's state lives in many module-level singletons and caches (policy,
// tariffs, solar adoption, decision log, per-year finances/emissions...), so a page
// reload is the one reliable way to get a clean slate for the next municipality. The
// app always opens on the start menu, so reloading lands there. (The game menu asks first.)
function returnToMenu() {
  window.location.reload();
}

// Dev-only handle for inspecting the simulation from the browser console.
if (import.meta.env.DEV) import("./dev/scenario").then((m) => Object.assign(window, { __scenario: m.runScenario }));
if (import.meta.env.DEV) import("./dev/perf").then((m) => Object.assign(window, { __perf: m.runPerf, __perfYearEnd: m.timeYearEndReport, __perfNewYear: m.timeNewYearPieces, __perfMapTick: m.timeMapPowerTick, __perfRolling: m.timeRollingChart }));
if (import.meta.env.DEV) Object.assign(window, { __debug: { stock, simClock, policyStore, treasury, measures, approval, reportCardStore, tariffStore, market, inbox, dynamicTariff, grid } });
if (import.meta.env.DEV) import("./sim/saveGame").then((m) => Object.assign(window, { __save: m }));
if (import.meta.env.DEV) import("./sim/history").then((m) => Object.assign(window, { __history: m }));
if (import.meta.env.DEV) import("./dev/par").then((m) => Object.assign(window, { __computePar: m.computePar }));

/** A run: a new game of `slug`, or — with `restore` — a saved one picked up where it was left. */
function Game({ slug, difficulty, transparency, restore }: { slug: string; difficulty: Difficulty; transparency: boolean; restore?: SaveFile }) {
  const [dataset, setDataset] = useState<MunicipalityDataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedEgid, setSelectedEgid] = useState<string | null>(null);
  const [selectedEwid, setSelectedEwid] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>("none");
  const [townHall, setTownHall] = useState<TownHallSection | null>(null);
  const showTownHall = townHall !== null;
  const [showWiki, setShowWiki] = useState(false);
  const [inboxSelection, setInboxSelection] = useState<InboxSelection | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  // The run's end: 2050's Year in Review closed (`finished`), or approval ended it.
  const [finished, setFinished] = useState(false);
  const gameOver = useSyncExternalStore(
    (l) => approval.subscribe(l),
    () => approval.getGameOver(),
  );
  const reportCardYear = useReportCardYear();
  const stockBuildings = useStockBuildings();
  const keyboardEnabled = !showTownHall && !showWiki && !showMenu && inboxSelection === null && reportCardYear === null;
  // Time keys work over the windows too (the inbox, the town hall, the wiki), but not over the
  // Year in Review or the tariff deadline, which hold the game where it is.
  const tariffDue = useTariffDeadline();
  useTimeKeyboard(reportCardYear === null && tariffDue === null);

  // Escape closes whatever is on top: the Year in Review, then the Wiki or the town hall, then a
  // charger being placed, then a dwelling (back to its building), a building, a selected charger,
  // and finally the map layer (back to Default, closing its panel). The game-over screen stays.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (approval.getGameOver()) return;
      if (reportCardYear !== null) reportCardStore.dismiss();
      else if (showMenu) setShowMenu(false);
      else if (inboxSelection !== null) setInboxSelection(null);
      else if (showWiki) setShowWiki(false);
      else if (showTownHall) setTownHall(null);
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
  }, [reportCardYear, showMenu, inboxSelection, showWiki, showTownHall, selectedEwid, selectedEgid, colorMode]);

  useEffect(() => {
    // A loaded game stays still until it is put back (applySave), then waits, paused.
    if (restore) simClock.setSpeed(0);
    simClock.start();
    const stopWatcher = startYearEndWatcher();
    return () => {
      simClock.stop();
      stopWatcher();
    };
  }, []);

  useEffect(() => {
    // Set up once: React may run this effect twice (StrictMode), and the modules are singletons.
    let cancelled = false;
    loadDataset(dataUrl(`${slug}.json`))
      .then((loaded) => {
        if (cancelled) return;
        loadPar(slug, difficulty); // what doing nothing scores here, if computed
        measures.init(difficulty); // before the stock: it registers the town size the measures' costs scale with
        market.init(`market:${loaded.bfsNumber}`); // before anything prices: the shocks of the whole game
        tariffStore.init();
        dynamicTariff.init(() => stock.getAll());
        approval.init(difficulty, `approval:${loaded.bfsNumber}`);
        initTariffApproval();
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
        setMeasureAvailability("fossil-heating-ban", (atMs) =>
          measures.externalOutlook(atMs).some((e) => e.id === "cantonal-fossil-heating-ban" && e.inEffect) ? "The canton's own ban is already in force." : null,
        );
        setMeasureAvailability("public-building-chargers", (atMs) =>
          publicCharging.publicBuildingChargerCandidates(atMs).length === 0 ? "Every public building (campus) already has chargers." : null,
        );
        bookInitialPublicCharging(stock.getAll()); // after the stock: it needs every building
        grid.init(loaded, () => stock.getAll()); // last: it reads every building's draw, public chargers included
        setDistrictHeatLimit((atMs) => networkFullAt(stock.getAll(), atMs));
        debt.init(() => stock.getAll(), `rates:${loaded.bfsNumber}`);
        // Letters and the paper last: they read everything above.
        inbox.init();
        letters.init(loaded, () => stock.getAll(), `letters:${loaded.bfsNumber}`);
        newspaper.init(loaded, () => stock.getAll(), `paper:${loaded.bfsNumber}`);
        if (restore) {
          applySave(restore);
          // Dev check: the state right after loading, to compare with the save (see saveGame.ts).
          if (import.meta.env.DEV) Object.assign(window, { __stateAfterLoad: stateJson(transparency) });
        }
        tariffDeadline.init(); // after a load, so it watches from the saved moment on
        setDataset(loaded);
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [slug, difficulty, restore]);

  // Each time a Year in Review is closed, the run is saved to this browser's one autosave slot.
  const shownReport = useRef<number | null>(null);
  useEffect(() => {
    if (reportCardYear !== null) {
      shownReport.current = reportCardYear;
      return;
    }
    if (shownReport.current === null || !dataset) return;
    if (shownReport.current === NET_ZERO_TARGET_YEAR) setFinished(true);
    shownReport.current = null;
    captureSave({ slug, municipality: dataset.name, difficulty, transparency }, "Autosave")
      .then(({ meta, bytes }) => putSave(AUTOSAVE_ID, meta, bytes))
      .catch((e: Error) => console.warn("Autosave failed:", e.message));
  }, [reportCardYear, dataset, slug, difficulty, transparency]);

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

  const onSelectFromList = (egid: string) => {
    setSelectedEgid(egid);
    setSelectedEwid(null);
  };
  const toolPanel =
    colorMode === "districtHeat" ? (
      <DistrictHeatPanel />
    ) : colorMode === "evCharging" ? (
      <EvChargingPanel />
    ) : colorMode === "zoning" ? (
      <ZoningPanel />
    ) : colorMode === "grid" ? (
      <GridPanel />
    ) : colorMode === "publicBuildings" ? (
      <PublicBuildingsPanel buildings={stockBuildings} realPlants={dataset.powerPlants} selectedEgid={selectedEgid} onSelectBuilding={onSelectFromList} />
    ) : null;

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <TopBar
        dataset={liveDataset ?? dataset}
        onOpenTreasury={() => setTownHall("treasury")}
        onOpenTownHall={() => setTownHall((open) => (open ? null : "overview"))}
        onOpenInbox={() => setInboxSelection((open) => (open ? null : { tab: "letters", id: null }))}
        onOpenWiki={() => setShowWiki((open) => !open)}
        onMenu={() => setShowMenu((open) => !open)}
      />
      <div className="stage">
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
        <LayerDock mode={colorMode} onChange={setColorMode} />
        {isToolLayer(colorMode) ? (
          <aside className="tool-drawer" aria-label={layerLabel(colorMode)}>
            {toolPanel}
            <details className="drawer-legend" open>
              <summary>Legend</summary>
              <LayerLegend mode={colorMode} />
            </details>
          </aside>
        ) : (
          <div className="map-legend">
            <h3 className="map-legend-title">{layerLabel(colorMode)}</h3>
            <LayerLegend mode={colorMode} />
          </div>
        )}
        {!inboxSelection && <InboxToast onOpen={setInboxSelection} />}
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
      {gameOver ? (
        <EndScreen municipality={dataset.name} over={gameOver} onMainMenu={returnToMenu} />
      ) : finished ? (
        <EndScreen municipality={dataset.name} over={null} onMainMenu={returnToMenu} onKeepPlaying={() => setFinished(false)} />
      ) : null}
      {townHall && (
        <TownHall dataset={liveDataset ?? dataset} transparency={transparency} section={townHall} onSection={setTownHall} onClose={() => setTownHall(null)} />
      )}
      {showWiki && <WikiPanel onClose={() => setShowWiki(false)} />}
      {showMenu && (
        <GameMenu run={{ slug, municipality: dataset.name, difficulty, transparency }} onClose={() => setShowMenu(false)} onMainMenu={returnToMenu} />
      )}
      {inboxSelection && (
        <InboxPanel
          initial={inboxSelection}
          onClose={() => setInboxSelection(null)}
          onSelectBuilding={(egid) => {
            setSelectedEgid(egid);
            setSelectedEwid(null);
          }}
        />
      )}
      {tariffDue !== null && reportCardYear === null && !townHall && !gameOver && (
        <TariffDeadlineDialog year={tariffDue} onOpenPrices={() => setTownHall("prices")} />
      )}
      {reportCardYear !== null && (
        <ReportCardModal dataset={liveDataset ?? dataset} year={reportCardYear} onClose={() => reportCardStore.dismiss()} />
      )}
    </div>
  );
}

export default function App() {
  const [choice, setChoice] = useState<{ slug: string; difficulty: Difficulty; transparency: boolean; restore?: SaveFile } | null>(null);
  return choice ? (
    <Game slug={choice.slug} difficulty={choice.difficulty} transparency={choice.transparency} restore={choice.restore} />
  ) : (
    <StartMenu
      onStart={(slug, difficulty, transparency, restore) => {
        // A saved run keeps its own calendar: set before anything starts counting time.
        if (restore) setEpoch(restore.meta.epochMs);
        setChoice({ slug, difficulty, transparency, restore });
      }}
    />
  );
}
