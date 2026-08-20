/**
 * Where the browser tests point.
 *
 * This used to be the literal `4173` written into the Playwright config and
 * three spec files. Windows then reserved the range 4120–4219 for its own
 * dynamic allocation and the preview server could no longer bind it — the
 * suite failed with EACCES on a port that `netstat` showed as free, which
 * reads like a code fault and is not one.
 *
 * Moving the port meant editing four files that had to agree. They now agree
 * by construction. If this port is ever reserved too, change it here only:
 *
 *   netsh interface ipv4 show excludedportrange protocol=tcp
 *
 * lists the ranges Windows has taken; pick anything outside them.
 */
export const E2E_PORT = 5273;

export const E2E_ORIGIN = `http://127.0.0.1:${E2E_PORT}`;
