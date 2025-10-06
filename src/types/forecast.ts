export interface LiabilityForecastPoint {
  period: string;
  point: number;
  lo: number | null;
  hi: number | null;
  advisory: boolean;
}
