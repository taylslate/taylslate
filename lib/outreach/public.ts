// Strip the outreach response token before a row leaves the server.
// The token is a bearer credential. Callers that already hold it
// (the emailed link) do not need it echoed back.

export function redactOutreach<T extends { token?: unknown }>(row: T): T {
  return { ...row, token: "" };
}

export function redactOutreaches<T extends { token?: unknown }>(rows: T[]): T[] {
  return rows.map((row) => redactOutreach(row));
}
