/**
 * Local persistence — off by default.
 *
 * Two separate stores with deliberately different rules:
 *
 *   localStorage  holds *settings only*: theme, viewpoint, whether saving is
 *                 enabled. Never a student, never an arrangement.
 *   IndexedDB     holds projects, and only after the teacher has switched
 *                 saving on and pressed «로컬에 저장». Nothing is written
 *                 automatically.
 *
 * Reopening the app therefore shows an empty roster unless the teacher asks
 * for the saved one, which is the safe default for a shared or classroom PC.
 */

import type {
  ArrangementRecord,
  Classroom,
  Grouping,
  RosterMeta,
  SeatAssignment,
  Student,
  Viewpoint,
} from '@/core/model/types';
import { SCHEMA_VERSION } from '@/core/model/types';
import type { Constraint } from '@/core/constraints/kinds';
import { log } from './log';

const SETTINGS_KEY = 'seatPlanner.settings.v1';
const DB_NAME = 'seat-planner';
const DB_VERSION = 1;
const PROJECT_STORE = 'projects';

/** Settings carry no personal data, which is why they may live in localStorage. */
export interface Settings {
  storageEnabled: boolean;
  viewpoint: Viewpoint;
  theme: 'light' | 'dark' | 'system';
  reduceMotion: boolean;
  showNumbers: boolean;
  showNames: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  storageEnabled: false,
  viewpoint: 'teacher',
  theme: 'system',
  reduceMotion: false,
  showNumbers: true,
  showNames: true,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(parsed as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    log.warn('settings could not be written');
  }
}

// ---------------------------------------------------------------------------
// Projects (IndexedDB)
// ---------------------------------------------------------------------------

export interface StoredProject {
  id: string;
  schemaVersion: number;
  savedAt: string;
  title: string;
  meta: RosterMeta | null;
  students: Student[];
  classroom: Classroom;
  constraints: Constraint[];
  assignment: SeatAssignment;
  grouping: Grouping | null;
  history: ArrangementRecord[];
  seed: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        db.createObjectStore(PROJECT_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('저장소를 열 수 없습니다.'));
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(PROJECT_STORE, mode);
        const request = work(tx.objectStore(PROJECT_STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error('저장소 작업에 실패했습니다.'));
        tx.oncomplete = () => db.close();
      }),
  );
}

export async function saveProject(project: Omit<StoredProject, 'schemaVersion' | 'savedAt'>): Promise<void> {
  const record: StoredProject = {
    ...project,
    schemaVersion: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
  };
  await withStore('readwrite', (store) => store.put(record));
}

export async function listProjects(): Promise<StoredProject[]> {
  const all = await withStore<StoredProject[]>('readonly', (store) => store.getAll());
  return [...all].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function deleteProject(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id));
}

// ---------------------------------------------------------------------------
// Erasure
// ---------------------------------------------------------------------------

export interface WipeReport {
  indexedDbDeleted: boolean;
  localStorageKeysRemoved: number;
  sessionStorageKeysRemoved: number;
  cachesDeleted: number;
  /** Result of re-checking after deletion. `true` means nothing was left. */
  verifiedEmpty: boolean;
  problems: string[];
}

function deleteDatabase(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve(true);
    request.onerror = () => resolve(false);
    // Another open tab can block deletion; report that rather than hanging.
    request.onblocked = () => resolve(false);
  });
}

/**
 * Erases every trace of student data this app can create, then verifies.
 *
 * Verification matters: "deleted" without a re-read is a promise, not a fact.
 */
export async function wipeEverything(): Promise<WipeReport> {
  const problems: string[] = [];
  const report: WipeReport = {
    indexedDbDeleted: false,
    localStorageKeysRemoved: 0,
    sessionStorageKeysRemoved: 0,
    cachesDeleted: 0,
    verifiedEmpty: false,
    problems,
  };

  try {
    report.indexedDbDeleted = await deleteDatabase(DB_NAME);
    if (!report.indexedDbDeleted) {
      problems.push('다른 탭에서 이 앱이 열려 있으면 저장소 삭제가 막힐 수 있습니다. 다른 탭을 닫고 다시 시도해 주세요.');
    }
  } catch {
    problems.push('저장소 삭제 중 문제가 발생했습니다.');
  }

  for (const storage of [localStorage, sessionStorage]) {
    try {
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (key && key.startsWith('seatPlanner.')) keys.push(key);
      }
      for (const key of keys) storage.removeItem(key);
      if (storage === localStorage) report.localStorageKeysRemoved = keys.length;
      else report.sessionStorageKeysRemoved = keys.length;
    } catch {
      problems.push('브라우저 저장 공간을 지우지 못했습니다.');
    }
  }

  // The service worker cache holds only hashed build assets, but clearing it
  // removes any doubt and simply causes the app to re-download itself.
  try {
    if (typeof caches !== 'undefined') {
      const names = await caches.keys();
      for (const name of names) await caches.delete(name);
      report.cachesDeleted = names.length;
    }
  } catch {
    problems.push('오프라인 캐시를 지우지 못했습니다.');
  }

  // --- verify ------------------------------------------------------------
  // Crucially, verification must NOT call `listProjects()`: `indexedDB.open`
  // recreates a database that has just been deleted, so checking by reading
  // would leave behind the very thing it claims to have removed.
  try {
    const leftoverKeys = Object.keys(localStorage).filter((k) => k.startsWith('seatPlanner.'));
    let databaseGone = true;
    if (typeof indexedDB.databases === 'function') {
      const remaining = await indexedDB.databases();
      databaseGone = !remaining.some((entry) => entry.name === DB_NAME);
    }
    report.verifiedEmpty = databaseGone && leftoverKeys.length === 0;
    if (!report.verifiedEmpty) problems.push('삭제 후 확인에서 남아 있는 항목이 발견되었습니다.');
  } catch {
    problems.push('삭제 결과를 확인하지 못했습니다. 브라우저 설정에서 사이트 데이터를 직접 확인해 주세요.');
    report.verifiedEmpty = false;
  }

  return report;
}
