import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Dashboard from '../Dashboard';
import BAS from '../BAS';
import { ComplianceProvider } from '../../context/ComplianceContext';

function createTestClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function renderWithCompliance(ui: React.ReactElement) {
  const queryClient = createTestClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ComplianceProvider>{ui}</ComplianceProvider>
    </QueryClientProvider>
  );
}

function mockFetchSequence(responses: Array<any | Error>) {
  const fetchMock = jest.spyOn(global, 'fetch' as any).mockImplementation((input: RequestInfo) => {
    if (!responses.length) {
      return Promise.reject(new Error(`Unexpected fetch call for ${typeof input === 'string' ? input : input.toString()}`));
    }
    const next = responses.shift();
    if (next instanceof Error) {
      return Promise.reject(next);
    }
    return Promise.resolve(
      new Response(JSON.stringify(next), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });
  return fetchMock;
}

describe('Compliance driven pages', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows a loading state while compliance data is being fetched', () => {
    jest.spyOn(global, 'fetch' as any).mockImplementation(() => new Promise(() => undefined));

    renderWithCompliance(<Dashboard />);

    expect(screen.getByText(/Loading compliance data/i)).toBeInTheDocument();
  });

  it('renders an error message when the compliance APIs fail', async () => {
    jest.spyOn(global, 'fetch' as any).mockImplementation(() => Promise.reject(new Error('network down')));

    renderWithCompliance(<BAS />);

    await waitFor(() => {
      expect(screen.getByText(/Unable to load BAS compliance/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/network down/i)).toBeInTheDocument();
  });

  it('renders compliance data pulled from the backend services', async () => {
    const responses = [
      {
        abn: '12345678901',
        taxType: 'GST',
        periodId: '2025-Q4',
        balance_cents: 0,
        has_release: true,
      },
      {
        abn: '12345678901',
        taxType: 'GST',
        periodId: '2025-Q4',
        rows: [
          {
            id: 1,
            amount_cents: 120000,
            balance_after_cents: 120000,
            rpt_verified: true,
            release_uuid: null,
            bank_receipt_id: null,
            created_at: new Date().toISOString(),
          },
        ],
      },
      {
        period_id: '2025-Q4',
        state: 'Remitted',
        reason_code: null,
        updated_at: new Date().toISOString(),
      },
      {
        period_id: '2025-Q4',
        rpt: null,
        audit: [
          {
            event_time: new Date().toISOString(),
            category: 'bas_gate',
            message: JSON.stringify({ ts: Math.floor(Date.now() / 1000) }),
          },
        ],
      },
    ];

    const fetchMock = mockFetchSequence(responses);

    renderWithCompliance(<Dashboard />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
      expect(screen.getByText(/Compliance Score/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Up to date/i)).toBeInTheDocument();
    expect(screen.getByText(/All paid/i)).toBeInTheDocument();
  });
});
