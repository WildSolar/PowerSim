/**
 * Saves kept in this browser (IndexedDB — a run is far too big for cookies or localStorage).
 * What a list shows (SaveMeta) is stored apart from the save itself, so listing stays quick.
 * Everything here lives only in this browser profile; exporting a save string is the way to
 * move a run elsewhere.
 */

import type { SaveMeta } from "./saveGame";

const DB_NAME = "commune-zero";
const DB_VERSION = 1;
const META = "meta";
const DATA = "data";

/** The one automatic save, overwritten each time (when a Year in Review is closed). */
export const AUTOSAVE_ID = "autosave";

export interface StoredSave {
  id: string;
  meta: SaveMeta;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "id" });
      if (!db.objectStoreNames.contains(DATA)) db.createObjectStore(DATA, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(stores: string[], mode: IDBTransactionMode, body: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      const request = body(tx);
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("The save was not written (the browser's storage may be full)."));
    });
  } finally {
    db.close();
  }
}

/** Every save in this browser, newest first. */
export async function listSaves(): Promise<StoredSave[]> {
  const all = (await run<StoredSave[]>([META], "readonly", (tx) => tx.objectStore(META).getAll())) ?? [];
  return all.sort((a, b) => b.meta.savedAt.localeCompare(a.meta.savedAt));
}

export async function putSave(id: string, meta: SaveMeta, bytes: Uint8Array): Promise<void> {
  await run([META, DATA], "readwrite", (tx) => {
    tx.objectStore(META).put({ id, meta });
    tx.objectStore(DATA).put({ id, bytes });
  });
}

export async function readSave(id: string): Promise<Uint8Array | null> {
  const record = await run<{ id: string; bytes: Uint8Array } | undefined>([DATA], "readonly", (tx) => tx.objectStore(DATA).get(id));
  return record?.bytes ?? null;
}

export async function deleteSave(id: string): Promise<void> {
  await run([META, DATA], "readwrite", (tx) => {
    tx.objectStore(META).delete(id);
    tx.objectStore(DATA).delete(id);
  });
}

/** A fresh id for a new named save. */
export function newSaveId(): string {
  return `save-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
