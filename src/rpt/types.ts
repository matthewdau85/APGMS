export interface RptTotals {
  paygw_cents: number;
  gst_cents: number;
}

export interface RptPayloadV01 {
  rpt_id: string;
  abn: string;
  bas_period: string;
  totals: RptTotals;
  evidence_merkle_root: string;
  rates_version: string;
  anomaly_score: number;
  iat: number;
  exp: number;
  nonce: string;
  kid: string;
}

export interface StoredRptToken {
  rpt_id: string;
  abn: string;
  tax_type: "PAYGW" | "GST";
  bas_period: string;
  kid: string;
  nonce: string;
  jws: string;
  payload: RptPayloadV01;
  expires_at: Date;
  status: string;
}

export interface KeyRecord {
  kid: string;
  privateKey: string;
  publicKey: string;
  status: "active" | "retired" | "revoked";
  createdAt: string;
}

export interface KeyStoreFile {
  active_kid: string;
  keys: KeyRecord[];
}
