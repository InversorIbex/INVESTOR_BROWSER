/**
 * Minimal logger. It never writes URLs with query strings, cookies, form data or
 * headers: only a scope and an error message, so logs cannot leak secrets.
 */
export function logError(scope: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  // Strip anything that looks like a query string or token from the message.
  const safe = message.replace(/\?[^\s'"]*/g, '?[redacted]').slice(0, 500);
  console.error(`[investor-browser] ${scope}: ${safe}`);
}

export function logInfo(scope: string, message: string): void {
  if (process.env.IB_DEBUG) console.log(`[investor-browser] ${scope}: ${message}`);
}
