import type { Page } from '@playwright/test';

export async function setupApiMocks(page: Page) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const { pathname, searchParams } = url;

    if (pathname === '/api/dashboard/yesterday') {
      return route.fulfill({ json: { totals: [] } });
    }
    if (pathname === '/api/metrics') {
      return route.fulfill({ status: 200, body: 'ok' });
    }
    if (pathname === '/api/readyz') {
      return route.fulfill({ status: 200, body: 'ok' });
    }
    if (pathname === '/api/connections' && route.request().method() === 'GET') {
      return route.fulfill({ json: [] });
    }
    if (pathname === '/api/connections/start') {
      return route.fulfill({ json: { url: 'https://example.com/oauth/start' } });
    }
    if (pathname.startsWith('/api/connections/') && route.request().method() === 'DELETE') {
      return route.fulfill({ json: { ok: true } });
    }
    if (pathname === '/api/transactions') {
      const q = searchParams.get('q') || '';
      const source = searchParams.get('source') || '';
      return route.fulfill({ json: { items: [], sources: source ? [source] : [] } });
    }
    if (pathname === '/api/jobs') {
      return route.fulfill({ json: [] });
    }
    if (pathname === '/api/ato/status') {
      return route.fulfill({ json: { status: 'Ready' } });
    }
    if (pathname === '/api/bas/preview') {
      return route.fulfill({ json: { ok: true } });
    }
    if (pathname === '/api/bas/validate' || pathname === '/api/bas/lodge') {
      return route.fulfill({ json: { ok: true } });
    }
    if (pathname === '/api/settings') {
      return route.fulfill({ json: { ok: true } });
    }
    if (pathname.startsWith('/api/')) {
      return route.fulfill({ json: {} });
    }

    return route.fallback();
  });
}
