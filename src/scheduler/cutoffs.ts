export interface Cutoff { rail: "EFT"|"BPAY"; weekday: number; hour: number; minute: number; }
export const AU_HOLIDAYS = new Set<string>([
  // "2025-01-01", ...
]);
export function isBankHoliday(d: Date) { return AU_HOLIDAYS.has(d.toISOString().slice(0,10)); }

export function nextWindow(now: Date, rail: "EFT"|"BPAY", cutoffs: Cutoff[]) {
  const candidates = cutoffs.filter(c => c.rail === rail);
  let best: Date | null = null;
  for (let i=0;i<14;i++){
    const d = new Date(now.getTime() + i*86400000);
    if (isBankHoliday(d)) continue;
    const weekday = d.getDay();
    for (const c of candidates) {
      if (c.weekday === weekday) {
        const dt = new Date(d); dt.setHours(c.hour, c.minute, 0, 0);
        if (dt > now && (!best || dt < best)) best = dt;
      }
    }
  }
  return best;
}
