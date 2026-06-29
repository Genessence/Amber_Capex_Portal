/**
 * IndexedDB-backed store for large base64 file blobs (Proforma Invoices, quote/line-item/land
 * attachments). These are kept OUT of the `capex_data_v2` localStorage payload so the workflow
 * state (statuses, quotes, metadata) always fits the ~5 MB localStorage quota and never fails to
 * persist. The whole file map is stored under a single record for simple atomic read/write.
 *
 * All functions degrade gracefully (resolve to {} / no-op) when IndexedDB is unavailable, so the
 * app never crashes — at worst, file blobs just don't survive a reload in that environment.
 */

const DB_NAME = 'capex_files_db';
const STORE = 'files';
const RECORD_KEY = 'all';

export type FileMap = Record<string, string>;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Read the full {key → base64} file map (empty object if none / unavailable). */
export async function getAllFiles(): Promise<FileMap> {
  const db = await openDb();
  if (!db) return {};
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(RECORD_KEY);
      req.onsuccess = () => resolve((req.result as FileMap) ?? {});
      req.onerror = () => resolve({});
    } catch {
      resolve({});
    } finally {
      // Close lazily after the microtask; the transaction holds the connection until done.
    }
  });
}

/** Overwrite the full {key → base64} file map. No-op if IndexedDB is unavailable. */
export async function putAllFiles(files: FileMap): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(files, RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
