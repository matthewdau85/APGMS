import React from "react";
import { t } from "../ui/i18n";

export default function Integrations() {
  const providers = [
    { nameKey: "settings.payroll.provider.myob", detailKey: "integrations.detail.payroll" },
    { nameKey: "settings.payroll.provider.quickbooks", detailKey: "integrations.detail.payroll" },
    { nameKey: "settings.sales.channel.square", detailKey: "integrations.detail.pos" },
    { nameKey: "settings.sales.channel.vend", detailKey: "integrations.detail.pos" }
  ];

  return (
    <div className="main-card space-y-4">
      <h1 style={{ color: "#00716b", fontWeight: 700, fontSize: 30, marginBottom: 0 }}>{t('integrations.title')}</h1>
      <p style={{ fontSize: 15, color: '#444' }}>{t('integrations.subtitle')}</p>
      <h3>{t('integrations.section.connect')}</h3>
      <ul className="space-y-2">
        {providers.map(provider => (
          <li key={provider.nameKey} className="flex items-center justify-between bg-white shadow rounded px-4 py-2">
            <span>
              {t(provider.nameKey)} ({t(provider.detailKey)})
            </span>
            <button className="button" style={{ marginLeft: 12 }}>{t('integrations.button.connect')}</button>
          </li>
        ))}
      </ul>
      <div style={{ marginTop: 12, fontSize: 15, color: "#888" }}>{t('integrations.coming_soon')}</div>
    </div>
  );
}
