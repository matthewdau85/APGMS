import { expect, test } from '@playwright/test';
import { setupApiMocks } from './utils';

test.describe('table empty states', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  const cases = [
    { route: 'connections', message: /No connections yet/i },
    { route: 'transactions', message: /No transactions to review yet/i },
  ];

  for (const { route, message } of cases) {
    test(`shows empty state on ${route}`, async ({ page }) => {
      await page.goto(`/#/${route}`);
      const empty = page.locator('[data-testid="empty-state"]');
      await expect(empty).toContainText(message);
    });
  }
});
