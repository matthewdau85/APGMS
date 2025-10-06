import { expect, test } from '@playwright/test';
import { setupApiMocks } from './utils';

const routes = ['home', 'connections', 'transactions', 'tax-bas', 'help', 'settings'];

test.describe('context panels', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  for (const route of routes) {
    test(`renders context panel on ${route}`, async ({ page }) => {
      await page.goto(`/#/${route}`);
      const panel = page.locator('[data-testid="context-panel"]');
      await expect(panel, `context panel missing on ${route}`).toBeVisible();
      await expect(panel.locator('h3')).toHaveText(/\S/);
      await expect(panel.locator('p')).toHaveText(/\S/);
    });
  }
});
