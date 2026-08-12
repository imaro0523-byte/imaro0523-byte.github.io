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
        // The connection must close on every path, not just the happy one. A
        // connection left open by an aborted transaction blocks
        // `deleteDatabase`, which is exactly when it matters most that the
        // database can actually be removed.
        const done = (finish: () => void) => {
          try {
            db.close();
          } catch {
            // Already closing; nothing useful to do.
          }
          finish();
        };

        let request: IDBRequest<T>;
        try {
          const tx = db.transaction(PROJECT_STORE, mode);
          request = work(tx.objectStore(PROJECT_STORE));
        } catch (error) {
          done(() => reject(error instanceof Error ? error : new Error('저장소 작업에 실패했습니다.')));
          return;
        }

        const tx = request.transaction;
        request.onsuccess = () => {
          const value = request.result;
          if (tx) tx.oncomplete = () => done(() => resolve(value));
          else done(() => resolve(value));
        };
        request.onerror = () => done(() => reject(new Error('저장소 작업에 실패했습니다.')));
        if (tx) {
          tx.onabort = () => done(() => reject(new Error('저장소 작업이 취소되었습니다.')));
          tx.onerror = () => done(() => reject(new Error('저장소 작업에 실패했습니다.')));
        }
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

export type DeleteOutcome = 'deleted' | 'blocked' | 'failed';

/** Whether the result of a wipe could be confirmed, and not merely asserted. */
export type Verification = 'verifiedEmpty' | 'leftovers' | 'unverifiable';

export interface WipeReport {
  database: DeleteOutcome;
  localStorageKeysRemoved: number;
  sessionStorageKeysRemoved: number;
  cachesDeleted: number;
  cachesSkipped: number;
  serviceWorkerRemoved: boolean;
  /**
   * `unverifiable` is a real answer, not a failure to produce one. Firefox has
   * no `indexedDB.databases()`, so there is no way to look. Reporting
   * "verified" there would be a claim the code cannot back up.
   */
  verification: Verification;
  problems: string[];
}

/**
 * Deletes the database, distinguishing all three outcomes the API can produce.
 *
 * `blocked` matters: it means another tab still holds a connection and the
 * deletion has *not* happened yet. Treating it as failure-and-carry-on would
 * let the app report success while the data is still on disk.
 */
function deleteDatabase(name: string): Promise<DeleteOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (outcome: DeleteOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.deleteDatabase(name);
    } catch {
      settle('failed');
      return;
    }

    request.onsuccess = () => settle('deleted');
    request.onerror = () => settle('failed');
    request.onblocked = () => settle('blocked');

    // A blocked deletion fires no further event until the other connection
    // closes, so it must not be allowed to hang the button forever.
    setTimeout(() => settle('blocked'), 4000);
  });
}

/**
 * Cache names this application is responsible for.
 *
 * Deleting every cache on the origin would reach into other sites hosted under
 * the same domain — `user.github.io` is shared by every one of that user's
 * projects — so erasure is limited to the caches this build creates.
 */
function isOwnCache(name: string): boolean {
  return name.startsWith('workbox-') || name.startsWith('seat-planner');
}

/**
 * Erases every trace of student data this app can create, then verifies.
 *
 * Verification matters: "deleted" without a re-read is a promise, not a fact.
 */
export async function wipeEverything(): Promise<WipeReport> {
  const problems: string[] = [];
  const report: WipeReport = {
    database: 'failed',
    localStorageKeysRemoved: 0,
    sessionStorageKeysRemoved: 0,
    cachesDeleted: 0,
    cachesSkipped: 0,
    serviceWorkerRemoved: false,
    verification: 'unverifiable',
    problems,
  };

  // The service worker goes first: it owns the caches, and unregistering it
  // afterwards would leave a worker running against caches that no longer
  // exist.
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
      report.serviceWorkerRemoved = registrations.length > 0;
    }
  } catch {
    problems.push('오프라인 기능을 끄지 못했습니다.');
  }

  report.database = await deleteDatabase(DB_NAME);
  if (report.database === 'blocked') {
    problems.push(
      '다른 탭에서 이 앱이 열려 있어 저장소를 지우지 못했습니다. 다른 탭을 모두 닫고 다시 눌러 주세요.',
    );
  } else if (report.database === 'failed') {
    problems.push('저장소를 지우는 중 문제가 발생했습니다.');
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

  // Only this app's caches. Other sites can share an origin — every project a
  // person publishes to user.github.io lives under the same one — and wiping
  // their caches is not ours to do.
  try {
    if (typeof caches !== 'undefined') {
      const names = await caches.keys();
      const mine = names.filter(isOwnCache);
      for (const name of mine) await caches.delete(name);
      report.cachesDeleted = mine.length;
      report.cachesSkipped = names.length - mine.length;
    }
  } catch {
    problems.push('오프라인 캐시를 지우지 못했습니다.');
  }

  // --- verify ------------------------------------------------------------
  // Verification must NOT call `listProjects()`: `indexedDB.open` recreates a
  // database that has just been deleted, so checking by reading would leave
  // behind the very thing it claims to have removed.
  try {
    const leftoverKeys = Object.keys(localStorage).filter((key) => key.startsWith('seatPlanner.'));
    const leftoverCaches =
      typeof caches !== 'undefined' ? (await caches.keys()).filter(isOwnCache) : [];

    if (report.database === 'blocked' || report.database === 'failed') {
      report.verification = 'leftovers';
    } else if (typeof indexedDB.databases !== 'function') {
      // Firefox does not implement it. Saying "verified" here would be a claim
      // this code cannot support, so it says so instead.
      report.verification = 'unverifiable';
      problems.push(
        '이 브라우저는 삭제 결과를 프로그램으로 확인하는 기능을 지원하지 않습니다. ' +
          '삭제는 요청했지만 확인은 하지 못했으니, 브라우저 설정 → 사이트 데이터에서 직접 확인해 주세요.',
      );
    } else {
      const remaining = await indexedDB.databases();
      const databaseGone = !remaining.some((entry) => entry.name === DB_NAME);
      const clean = databaseGone && leftoverKeys.length === 0 && leftoverCaches.length === 0;
      report.verification = clean ? 'verifiedEmpty' : 'leftovers';
      if (!clean) problems.push('삭제 후 확인에서 남아 있는 항목이 발견되었습니다.');
    }
  } catch {
    report.verification = 'unverifiable';
    problems.push('삭제 결과를 확인하지 못했습니다. 브라우저 설정에서 사이트 데이터를 직접 확인해 주세요.');
  }

  return report;
}
