import { expect, test } from '@playwright/test';
import { setupApiMocks } from './utils';

const expectedGlossary: Record<string, string> = {
  BAS: 'Business Activity Statement',
  PAYGW: 'Pay As You Go Withholding',
  CDR: 'Consumer Data Right (Open Banking)',
  POS: 'Point of Sale',
  SBR: 'Standard Business Reporting',
};

const routes = ['home', 'connections', 'transactions', 'tax-bas', 'help', 'settings'];

test.describe('glossary terms', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('every glossary term renders with tooltip text', async ({ page }) => {
    const found = new Map<string, string>();

    for (const route of routes) {
      await page.goto(`/#/${route}`);
      const terms = await page.$$('[data-glossary-term]');
      for (const term of terms) {
        const key = await term.getAttribute('data-glossary-term');
        const title = await term.getAttribute('title');
        if (key && title) {
          found.set(key, title);
        }
      }
    }

    for (const [term, description] of Object.entries(expectedGlossary)) {
      expect(found.has(term), `missing glossary term ${term}`).toBeTruthy();
      expect(found.get(term)).toBe(description);
    }
  });
});
