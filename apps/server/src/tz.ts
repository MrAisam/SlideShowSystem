/** Epoch ms of local midnight (in `timeZone`) for the day containing `now`. */
export function startOfDayMs(now: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(now)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const elapsedMs = (((p.hour ?? 0) * 60 + (p.minute ?? 0)) * 60 + (p.second ?? 0)) * 1000;
  return now.getTime() - elapsedMs - now.getMilliseconds();
}
