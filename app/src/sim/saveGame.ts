/**
 * Saving and loading a run. A save is a snapshot of every module's state at one moment — not a
 * replay of the player's decisions: households decide lazily, under the policy in force when
 * they are looked at, so only the state itself reproduces the run faithfully. What any module
 * can rebuild from the dataset and the seeds (geometry, profiles, weather, interest rates) is
 * left out; it is recomputed when the game starts.
 *
 * Loading starts the municipality exactly as a new game (App.tsx), then puts every module back
 * as it was (applySave) — with the clock still at the start, so nothing catches up on the way —
 * and finally moves the clock to the saved moment, paused.
 *
 * Every save carries the build it was made with (the git commit), and only that build loads it:
 * a save from any other version is refused rather than migrated.
 */

import type { Difficulty } from "../config/difficulty";
import { snapshotAdditionality, restoreAdditionality } from "./additionality";
import { approval } from "./approval";
import { EPOCH_MS, toDateMs } from "./calendar";
import { debt } from "./debt";
import { restoreDecisionLog, snapshotDecisionLog } from "./decisionLog";
import { districtHeat } from "./districtHeat";
import { restoreEmissions, snapshotEmissions } from "./emissions";
import { simClock } from "./engine";
import { bookedFinances, restoreFinances, snapshotFinances } from "./finances";
import { fleets } from "./fleet";
import { grid } from "./grid";
import { inbox } from "./inbox";
import { letters } from "./letters";
import { measures } from "./measures";
import { resetMobilityHandles, slotFromRef, slotRefOf, type SlotRef } from "./mobility";
import { restoreModeChains, snapshotModeChains } from "./modeRenewal";
import { newspaper } from "./newspaper";
import { publicCharging } from "./publicCharging";
import { restoreRenewalChains, snapshotRenewalChains } from "./renewal";
import { restoreScore, snapshotScore } from "./score";
import { roofContracts } from "./roofContracts";
import { agriPv } from "./agriPv";
import { restoreSolar, snapshotSolar } from "./solarAdoption";
import { stock } from "./stock";
import { studies } from "./studies";
import { tariffStore } from "./tariffStore";
import { treasury } from "./treasury";
import { restoreYearReport, snapshotYearReport } from "./yearReport";
import { resetYearEndWatcher } from "./yearEndWatcher";
import { zoning } from "./zoning";
import { decodeJson, encodeJson, fromBase64, gunzip, gzip, toBase64 } from "./saveCodec";
import { VERSION_LABEL } from "../changelog";

/** This build's version: a save only loads into the build that made it. */
export const GAME_VERSION: string = __GAME_VERSION__;

const FORMAT = "commune-zero-save";
/** The prefix of an exported save string. */
const STRING_PREFIX = "CZ1:";

/** What describes a save without opening it: shown in the lists. */
export interface SaveMeta {
  format: typeof FORMAT;
  /** The build (git commit) that made it: only the same build loads it. */
  version: string;
  /** The public version that made it ("0.1.0"), for the lists. Absent in the earliest saves. */
  release?: string;
  /** When it was saved, in real time (ISO). */
  savedAt: string;
  /** The player's name for it ("Autosave" for the automatic one). */
  name: string;
  slug: string;
  municipality: string;
  difficulty: Difficulty;
  transparency: boolean;
  simTimeMs: number;
  /** The real day the run started on: its calendar is counted from it. */
  epochMs: number;
  /** For the list: the in-game date, approval and treasury. */
  dateLabel: string;
  approval: number;
}

export interface SaveFile {
  meta: SaveMeta;
  state: SaveState;
}

interface SaveState {
  tariff: ReturnType<typeof tariffStore.snapshot>;
  measures: ReturnType<typeof measures.snapshot>;
  treasury: ReturnType<typeof treasury.snapshot>;
  renewalChains: ReturnType<typeof snapshotRenewalChains>;
  modeChains: ReturnType<typeof snapshotModeChains>;
  solar: ReturnType<typeof snapshotSolar>;
  stock: ReturnType<typeof stock.snapshot>;
  zoning: ReturnType<typeof zoning.snapshot>;
  districtHeat: ReturnType<typeof districtHeat.snapshot>;
  grid: ReturnType<typeof grid.snapshot>;
  publicCharging: ReturnType<typeof publicCharging.snapshot>;
  approval: ReturnType<typeof approval.snapshot>;
  debt: ReturnType<typeof debt.snapshot>;
  studies: ReturnType<typeof studies.snapshot>;
  letters: ReturnType<typeof letters.snapshot>;
  inbox: ReturnType<typeof inbox.snapshot>;
  newspaper: ReturnType<typeof newspaper.snapshot>;
  additionality: ReturnType<typeof snapshotAdditionality>;
  decisionLog: ReturnType<typeof snapshotDecisionLog> | null;
  emissions: ReturnType<typeof snapshotEmissions>;
  finances: ReturnType<typeof snapshotFinances>;
  score: ReturnType<typeof snapshotScore>;
  roofContracts: ReturnType<typeof roofContracts.snapshot>;
  agriPv: ReturnType<typeof agriPv.snapshot>;
  yearReport: Awaited<ReturnType<typeof snapshotYearReport>>;
}

export class SaveError extends Error {}

export interface RunInfo {
  slug: string;
  municipality: string;
  difficulty: Difficulty;
  transparency: boolean;
}

function dateLabel(simTimeMs: number): string {
  return new Date(toDateMs(simTimeMs)).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** The running game, as a save — gzip-compressed JSON. The game must be paused (the town hall's
 * menu pauses it): everything is read in one go after the year report's samples have settled. */
export async function captureSave(run: RunInfo, name: string): Promise<{ meta: SaveMeta; bytes: Uint8Array }> {
  const booked = bookedFinances();
  const firstOpenYear = booked.length > 0 ? booked[booked.length - 1].year + 1 : new Date(toDateMs(0)).getUTCFullYear();
  const yearReport = await snapshotYearReport(firstOpenYear);

  const simTimeMs = simClock.getSimTimeMs();
  const meta: SaveMeta = {
    format: FORMAT,
    version: GAME_VERSION,
    release: VERSION_LABEL,
    savedAt: new Date().toISOString(),
    name,
    slug: run.slug,
    municipality: run.municipality,
    difficulty: run.difficulty,
    transparency: run.transparency,
    simTimeMs,
    epochMs: EPOCH_MS,
    dateLabel: dateLabel(simTimeMs),
    approval: Math.round(approval.getApproval()),
  };
  const state: SaveState = { ...captureState(run.transparency), yearReport };
  // Serialised straight away, before anything can move on.
  const json = encodeJson({ meta, state } satisfies SaveFile);
  return { meta, bytes: await gzip(json) };
}

/** Every module's state right now, apart from the year report's samples. */
export function captureState(transparency: boolean): Omit<SaveState, "yearReport"> {
  return {
    tariff: tariffStore.snapshot(),
    measures: measures.snapshot(),
    treasury: treasury.snapshot(),
    renewalChains: snapshotRenewalChains(),
    modeChains: snapshotModeChains(),
    solar: snapshotSolar(),
    stock: stock.snapshot(),
    zoning: zoning.snapshot(),
    districtHeat: districtHeat.snapshot(),
    grid: grid.snapshot(),
    publicCharging: publicCharging.snapshot(slotRefOf),
    approval: approval.snapshot(),
    debt: debt.snapshot(),
    studies: studies.snapshot(),
    letters: letters.snapshot(),
    inbox: inbox.snapshot(),
    newspaper: newspaper.snapshot(),
    additionality: snapshotAdditionality(),
    // The decision log is only ever shown in transparency mode, and it is large.
    decisionLog: transparency ? snapshotDecisionLog() : null,
    emissions: snapshotEmissions(),
    finances: snapshotFinances(),
    score: snapshotScore(),
    roofContracts: roofContracts.snapshot(),
    agriPv: agriPv.snapshot(),
  };
}

/** The state as JSON, for comparing two moments (a dev check of saving and loading). */
export function stateJson(transparency: boolean): string {
  return encodeJson(captureState(transparency));
}

/** Opens a save, refusing anything that isn't one, or comes from another version. */
export async function openSave(bytes: Uint8Array): Promise<SaveFile> {
  let file: SaveFile;
  try {
    file = decodeJson<SaveFile>(await gunzip(bytes));
  } catch {
    throw new SaveError("This isn't a Commune Zéro save, or it has been damaged.");
  }
  if (file?.meta?.format !== FORMAT || !file.state) throw new SaveError("This isn't a Commune Zéro save.");
  checkVersion(file.meta);
  return file;
}

/** "0.1.0 (build abc1234)", or just the build for the earliest saves. */
export function versionOf(meta: SaveMeta): string {
  return meta.release ? `${meta.release}, build ${meta.version}` : `build ${meta.version}`;
}

/** Whether a save can be loaded into this build. */
export function isCompatible(meta: SaveMeta): boolean {
  return meta.version === GAME_VERSION;
}

function checkVersion(meta: SaveMeta): void {
  if (!isCompatible(meta)) {
    throw new SaveError(
      `This save was made with another version of Commune Zéro (${versionOf(meta)}; this is ${VERSION_LABEL}, build ${GAME_VERSION}). For now, a save can only be loaded into the exact version that made it.`,
    );
  }
}

/** A save as text, to copy elsewhere. */
export function saveToString(bytes: Uint8Array): string {
  return STRING_PREFIX + toBase64(bytes);
}

/** A save string back to a save. */
export async function saveFromString(text: string): Promise<SaveFile> {
  const trimmed = text.trim();
  if (!trimmed.startsWith(STRING_PREFIX)) throw new SaveError("This doesn't look like a Commune Zéro save string — it should start with “CZ1:”.");
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(trimmed.slice(STRING_PREFIX.length));
  } catch {
    throw new SaveError("This save string is incomplete or damaged.");
  }
  return openSave(bytes);
}

/** Puts a saved run back, on top of a freshly started game of the same municipality and
 * difficulty. Order matters: what others look things up in comes first. */
export function applySave(file: SaveFile): void {
  // The modules take the saved objects over as their own, so they get a copy: the save stays as it was.
  const s = structuredClone(file.state);
  simClock.setSpeed(0);
  tariffStore.restore(s.tariff);
  measures.restore(s.measures);
  treasury.restore(s.treasury);
  restoreRenewalChains(s.renewalChains);
  restoreModeChains(s.modeChains);
  restoreSolar(s.solar);
  stock.restore(s.stock);
  zoning.restore(s.zoning);
  districtHeat.restore(s.districtHeat);
  grid.restore(s.grid);
  // Slot handles and vehicles cached what they found at the start; they re-derive from here.
  resetMobilityHandles();
  fleets.resetCaches();
  publicCharging.restore(s.publicCharging, (ref) => slotFromRef(ref as SlotRef | null));
  approval.restore(s.approval, (key) =>
    key.startsWith("zoning:")
      ? (accepted) => zoning.voteResult(Number(key.slice("zoning:".length)), accepted)
      : key.startsWith("agriPv:")
        ? (accepted) => agriPv.voteResult(Number(key.slice("agriPv:".length)), accepted)
        : (accepted, atMs, yes) => measures.resolveVote(key, accepted, atMs, yes),
  );
  debt.restore(s.debt);
  studies.restore(s.studies);
  letters.restore(s.letters);
  inbox.restore(s.inbox);
  newspaper.restore(s.newspaper);
  restoreAdditionality(s.additionality);
  restoreDecisionLog(s.decisionLog);
  restoreEmissions(s.emissions);
  restoreFinances(s.finances);
  restoreScore(s.score);
  roofContracts.restore(s.roofContracts);
  agriPv.restore(s.agriPv);
  restoreYearReport(s.yearReport);
  // The clock jumps to the saved moment, paused. That is not a year ending.
  resetYearEndWatcher();
  simClock.pauseAt(file.meta.simTimeMs);
}
