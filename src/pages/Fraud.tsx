import React, { useState } from "react";
import { t } from "../ui/i18n";

export default function Fraud() {
  const [alerts] = useState([
    { date: "02/06/2025", detailKey: "fraud.alert.paygw" },
    { date: "16/05/2025", detailKey: "fraud.alert.gst" }
  ]);
  return (
    <div className="main-card">
      <h1 style={{ color: "#00716b", fontWeight: 700, fontSize: 30, marginBottom: 28 }}>{t('fraud.title')}</h1>
      <h3>{t('fraud.subtitle')}</h3>
      <ul>
        {alerts.map((row, i) => (
          <li key={i} style={{ color: "#e67c00", fontWeight: 500, marginBottom: 7 }}>
            {row.date}: {t(row.detailKey)}
          </li>
        ))}
      </ul>
      <div style={{ marginTop: 24, fontSize: 15, color: "#888" }}>{t('fraud.coming_soon')}</div>
    </div>
  );
}
