export function nowIso(): string {
  return new Date().toISOString();
}

export function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}
