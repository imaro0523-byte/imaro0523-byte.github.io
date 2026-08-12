/**
 * The only logging entry point in the application.
 *
 * Two rules are enforced here rather than by convention:
 *
 * 1. In a production build every call is a no-op, so nothing a teacher does can
 *    end up in the browser console on a shared or projected screen.
 * 2. The argument type `LogSafe` cannot represent a `Student`, a roster or an
 *    assignment map, so it is a type error to log personal data even in dev.
 */

/** Values that carry no personal data and are therefore safe to log. */
export type LogSafe = string | number | boolean | null | undefined;

const isDev = import.meta.env?.DEV === true;

function emit(level: 'debug' | 'warn' | 'error', message: string, ...values: LogSafe[]): void {
  if (!isDev) return;
  // eslint-disable-next-line no-console
  console[level](`[seat-planner] ${message}`, ...values);
}

export const log = {
  debug: (message: string, ...values: LogSafe[]) => emit('debug', message, ...values),
  warn: (message: string, ...values: LogSafe[]) => emit('warn', message, ...values),
  error: (message: string, ...values: LogSafe[]) => emit('error', message, ...values),
};

/**
 * Reduces a caught value to a message with no payload attached.
 *
 * Parser errors can otherwise carry a cell value — and therefore a student
 * name — inside the message or a custom property.
 */
export function safeErrorMessage(error: unknown, fallback = '알 수 없는 오류가 발생했습니다.'): string {
  if (error instanceof Error && typeof error.message === 'string' && error.message !== '') {
    return error.message;
  }
  return fallback;
}
