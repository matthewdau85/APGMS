import React from 'react';
import { t } from '../ui/i18n';

export default function Help() {
  const gettingStartedKeys = [
    'help.getting_started.settings',
    'help.getting_started.wizard',
    'help.getting_started.dashboard',
    'help.getting_started.bas'
  ];

  const complianceKeys = [
    'help.compliance.accounts',
    'help.compliance.audit',
    'help.compliance.penalties'
  ];

  const supportLinks = [
    { href: 'https://www.ato.gov.au/business/payg-withholding/', labelKey: 'help.links.paygw' },
    { href: 'https://www.ato.gov.au/business/gst/', labelKey: 'help.links.gst' },
    { href: 'https://www.ato.gov.au/business/business-activity-statements-(bas)/', labelKey: 'help.links.bas' },
    { href: 'https://www.ato.gov.au/business/super-for-employers/', labelKey: 'help.links.super' },
    { href: 'https://www.ato.gov.au/General/Online-services/', labelKey: 'help.links.services' }
  ];

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">{t('help.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('help.subtitle')}</p>
      <div className="bg-card p-4 rounded-xl shadow space-y-2">
        <h2 className="text-lg font-semibold">{t('help.section.getting_started')}</h2>
        <ul className="list-disc pl-5 text-sm">
          {gettingStartedKeys.map(itemKey => (
            <li key={itemKey}>{t(itemKey)}</li>
          ))}
        </ul>
      </div>
      <div className="bg-card p-4 rounded-xl shadow space-y-2">
        <h2 className="text-lg font-semibold">{t('help.section.compliance')}</h2>
        <ul className="list-disc pl-5 text-sm">
          {complianceKeys.map(itemKey => (
            <li key={itemKey}>{t(itemKey)}</li>
          ))}
        </ul>
      </div>
      <div className="bg-card p-4 rounded-xl shadow space-y-2">
        <h2 className="text-lg font-semibold">{t('help.section.links')}</h2>
        <ul className="list-disc pl-5 text-sm">
          {supportLinks.map(link => (
            <li key={link.href}>
              <a className="text-blue-600" href={link.href}>
                {t(link.labelKey)}
              </a>
            </li>
          ))}
        </ul>
      </div>
      <div className="bg-card p-4 rounded-xl shadow space-y-2">
        <h2 className="text-lg font-semibold">{t('help.section.writing')}</h2>
        <p className="text-sm text-muted-foreground">{t('help.writing_style.desc')}</p>
        <a className="text-blue-600 text-sm underline" href="/content/style-guide.md">
          {t('help.writing_style.link')}
        </a>
      </div>
    </div>
  );
}
