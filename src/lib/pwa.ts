/**
 * Offline support.
 *
 * The build produces a service worker, but registering one is a decision with
 * consequences — it puts a copy of the application into a cache that outlives
 * the tab — so it happens only when a teacher asks for it, and it can be undone
 * from the same switch.
 *
 * An audit found the previous state of this: the worker was generated and never
 * registered, while the README promised offline use. Nothing was cached and
 * nothing worked offline. Registration now exists and is visible in Settings.
 *
 * What the cache holds is only the app's own hashed build files. Student data
 * is never fetched over the network, so there is nothing about a class for a
 * service worker to intercept or store.
 */

import { log } from './log';

const SW_URL = './sw.js';

export function serviceWorkerSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

/** True when this browser currently has the app registered for offline use. */
export async function isOfflineReady(): Promise<boolean> {
  if (!serviceWorkerSupported()) return false;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    return registrations.length > 0;
  } catch {
    return false;
  }
}

export async function enableOffline(): Promise<{ ok: boolean; message: string }> {
  if (!serviceWorkerSupported()) {
    return { ok: false, message: '이 브라우저는 오프라인 사용을 지원하지 않습니다.' };
  }
  try {
    const registration = await navigator.serviceWorker.register(SW_URL, { scope: './' });
    await registration.update().catch(() => undefined);
    return {
      ok: true,
      message:
        '오프라인 사용을 켰습니다. 앱 파일이 이 브라우저에 저장되어 인터넷 없이도 열립니다. ' +
        '학생 정보는 저장되지 않습니다.',
    };
  } catch (error) {
    log.warn('service worker registration failed', (error as Error).name);
    return {
      ok: false,
      message:
        '오프라인 사용을 켜지 못했습니다. 브라우저가 이 기능을 막고 있거나 http로 열려 있을 수 있습니다.',
    };
  }
}

/**
 * Unregisters the worker and drops its caches.
 *
 * Used by the settings switch and by «모든 정보 삭제», so that turning the app
 * off really does leave nothing behind.
 */
export async function disableOffline(): Promise<void> {
  if (!serviceWorkerSupported()) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch {
    log.warn('service worker could not be unregistered');
  }
}
