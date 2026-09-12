// Metadata captured from the request for a refresh-token row, purely
// informational (never used for authorization decisions) - lets a future
// "your active sessions" screen show something more useful than a bare
// list of dates.
export interface SessionMeta {
  userAgent?: string;
  ipAddress?: string;
}
