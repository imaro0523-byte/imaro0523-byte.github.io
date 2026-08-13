/**
 * Build identity, shown in feedback reports so a bug can be tied to a version.
 *
 * Carries no user data and no build machine details — just the version from
 * package.json and the date the bundle was made.
 */
export const APP_VERSION = __APP_VERSION__;
