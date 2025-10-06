import React, { useState } from "react";
import { t } from "../ui/i18n";

const tabKeys = [
  "settings.tab.business_profile",
  "settings.tab.accounts",
  "settings.tab.payroll_sales",
  "settings.tab.transfers",
  "settings.tab.security",
  "settings.tab.audit",
  "settings.tab.customisation",
  "settings.tab.notifications",
  "settings.tab.advanced"
] as const;

type TabKey = (typeof tabKeys)[number];

export default function Settings() {
  const [activeTab, setActiveTab] = useState<TabKey>(tabKeys[0]);
  const [profile, setProfile] = useState({
    abn: "12 345 678 901",
    name: "Example Pty Ltd",
    trading: "Example Vending",
    contact: "info@example.com"
  });

  const accountRows = [
    {
      nameKey: "settings.accounts.row.main_name",
      bsb: "123-456",
      number: "11111111",
      typeKey: "settings.accounts.row.main_type"
    },
    {
      nameKey: "settings.accounts.row.reserve_name",
      bsb: "123-456",
      number: "22222222",
      typeKey: "settings.accounts.row.reserve_type"
    }
  ];

  const payrollProviders = [
    "settings.payroll.provider.myob",
    "settings.payroll.provider.quickbooks"
  ];

  const salesChannels = [
    "settings.sales.channel.vend",
    "settings.sales.channel.square"
  ];

  return (
    <div className="settings-card">
      <div className="tabs-row">
        {tabKeys.map(key => (
          <div
            key={key}
            className={`tab-item${activeTab === key ? " active" : ""}`}
            onClick={() => setActiveTab(key)}
            tabIndex={0}
          >
            {t(key)}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 30 }}>
        {activeTab === "settings.tab.business_profile" && (
          <form
            style={{
              background: "#f9f9f9",
              borderRadius: 12,
              padding: 24,
              maxWidth: 650
            }}
          >
            <div style={{ marginBottom: 16 }}>
              <label>{t("settings.business_profile.abn_label")}</label>
              <input
                className="settings-input"
                style={{ width: "100%" }}
                value={profile.abn}
                onChange={e => setProfile({ ...profile, abn: e.target.value })}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label>{t("settings.business_profile.legal_name_label")}</label>
              <input
                className="settings-input"
                style={{ width: "100%" }}
                value={profile.name}
                onChange={e => setProfile({ ...profile, name: e.target.value })}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label>{t("settings.business_profile.trading_name_label")}</label>
              <input
                className="settings-input"
                style={{ width: "100%" }}
                value={profile.trading}
                onChange={e => setProfile({ ...profile, trading: e.target.value })}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label>{t("settings.business_profile.contact_label")}</label>
              <input
                className="settings-input"
                style={{ width: "100%" }}
                value={profile.contact}
                onChange={e => setProfile({ ...profile, contact: e.target.value })}
              />
            </div>
          </form>
        )}

        {activeTab === "settings.tab.accounts" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <h3>{t("settings.accounts.title")}</h3>
            <table>
              <thead>
                <tr>
                  <th>{t("settings.accounts.header.account")}</th>
                  <th>{t("settings.accounts.header.bsb")}</th>
                  <th>{t("settings.accounts.header.number")}</th>
                  <th>{t("settings.accounts.header.type")}</th>
                  <th>{t("settings.accounts.header.action")}</th>
                </tr>
              </thead>
              <tbody>
                {accountRows.map(row => (
                  <tr key={row.nameKey}>
                    <td>{t(row.nameKey)}</td>
                    <td>{row.bsb}</td>
                    <td>{row.number}</td>
                    <td>{t(row.typeKey)}</td>
                    <td>
                      <button className="button" style={{ padding: "2px 14px", fontSize: 14 }}>
                        {t("settings.accounts.button.remove")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 18 }}>
              <button className="button">{t("settings.accounts.button.add")}</button>
            </div>
          </div>
        )}

        {activeTab === "settings.tab.payroll_sales" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <h3>{t("settings.payroll.title")}</h3>
            <ul>
              {payrollProviders.map(providerKey => (
                <li key={providerKey}>{t(providerKey)}</li>
              ))}
            </ul>
            <button className="button" style={{ marginTop: 10 }}>
              {t("settings.payroll.button.add")}
            </button>
            <h3 style={{ marginTop: 24 }}>{t("settings.sales.title")}</h3>
            <ul>
              {salesChannels.map(channelKey => (
                <li key={channelKey}>{t(channelKey)}</li>
              ))}
            </ul>
            <button className="button" style={{ marginTop: 10 }}>
              {t("settings.sales.button.add")}
            </button>
          </div>
        )}

        {activeTab === "settings.tab.transfers" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <h3>{t("settings.transfers.title")}</h3>
            <table>
              <thead>
                <tr>
                  <th>{t("settings.transfers.header.type")}</th>
                  <th>{t("settings.transfers.header.amount")}</th>
                  <th>{t("settings.transfers.header.frequency")}</th>
                  <th>{t("settings.transfers.header.next")}</th>
                  <th>{t("settings.transfers.header.action")}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{t("settings.transfers.row.paygw_type")}</td>
                  <td>$1,000</td>
                  <td>{t("settings.transfers.row.frequency_weekly")}</td>
                  <td>05/06/2025</td>
                  <td>
                    <button className="button" style={{ padding: "2px 14px", fontSize: 14 }}>
                      {t("settings.transfers.button.edit")}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div style={{ marginTop: 18 }}>
              <button className="button">{t("settings.transfers.button.add")}</button>
            </div>
          </div>
        )}

        {activeTab === "settings.tab.security" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <h3>{t("settings.security.title")}</h3>
            <label>
              <input type="checkbox" defaultChecked /> {t("settings.security.two_factor")}
            </label>
            <br />
            <label>
              <input type="checkbox" /> {t("settings.security.sms_payments")}
            </label>
          </div>
        )}

        {activeTab === "settings.tab.audit" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <h3>{t("settings.audit.title")}</h3>
            <ul>
              <li>{t("settings.audit.entry.transfer")}</li>
              <li>{t("settings.audit.entry.bas")}</li>
            </ul>
          </div>
        )}

        {activeTab === "settings.tab.customisation" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <h3>{t("settings.customisation.title")}</h3>
            <button className="button" style={{ marginRight: 10 }}>{t("settings.customisation.button.ato")}</button>
            <button className="button" style={{ background: "#262626" }}>{t("settings.customisation.button.dark")}</button>
          </div>
        )}

        {activeTab === "settings.tab.notifications" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <h3>{t("settings.notifications.title")}</h3>
            <label>
              <input type="checkbox" defaultChecked /> {t("settings.notifications.email_due")}
            </label>
            <br />
            <label>
              <input type="checkbox" /> {t("settings.notifications.sms_lodgment")}
            </label>
          </div>
        )}

        {activeTab === "settings.tab.advanced" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <h3>{t("settings.advanced.title")}</h3>
            <button className="button">{t("settings.advanced.button.csv")}</button>
          </div>
        )}
      </div>
    </div>
  );
}
