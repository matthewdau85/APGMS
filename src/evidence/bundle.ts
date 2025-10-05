export type Evidence = {
  expC: number;
  actC: number;
  delta: number;
  toleranceBps: number;
  anomalyHash: string;
  ledgerHead: string;
};

export function summarize(ev: Evidence) {
  const pct = ev.expC === 0 ? 0 : (ev.delta / ev.expC) * 100;
  return {
    expected: ev.expC / 100,
    actual: ev.actC / 100,
    delta: ev.delta / 100,
    deltaPct: Number(pct.toFixed(3)),
    tolerancePct: ev.toleranceBps / 100,
    anomalyHash: ev.anomalyHash,
    ledgerHead: ev.ledgerHead,
  };
}
