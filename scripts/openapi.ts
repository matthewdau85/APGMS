import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'APGMS API',
    version: '0.1.0',
    description: 'API surface for the Automated PAYGW & GST Management System.',
  },
  servers: [{ url: 'http://localhost:3000' }],
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        responses: {
          '200': {
            description: 'Health check response',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { ok: { type: 'boolean' } },
                },
              },
            },
          },
        },
      },
    },
    '/api/pay': {
      post: {
        summary: 'Release payment to ATO',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['abn', 'taxType', 'periodId', 'rail'],
                properties: {
                  abn: { type: 'string' },
                  taxType: { type: 'string', enum: ['PAYGW', 'GST'] },
                  periodId: { type: 'string' },
                  rail: { type: 'string', enum: ['EFT', 'BPAY'] },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Release accepted',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          '400': {
            description: 'Validation error',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
    '/api/close-issue': {
      post: {
        summary: 'Close period and issue RPT',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['abn', 'taxType', 'periodId'],
                properties: {
                  abn: { type: 'string' },
                  taxType: { type: 'string', enum: ['PAYGW', 'GST'] },
                  periodId: { type: 'string' },
                  thresholds: { type: 'object', additionalProperties: { type: 'number' } },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'RPT issued' },
          '400': { description: 'Failed to issue RPT' },
        },
      },
    },
    '/api/payto/sweep': {
      post: {
        summary: 'Initiate PayTo sweep',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['abn', 'amount_cents', 'reference'],
                properties: {
                  abn: { type: 'string' },
                  amount_cents: { type: 'integer' },
                  reference: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Sweep scheduled' },
        },
      },
    },
    '/api/settlement/webhook': {
      post: {
        summary: 'Settlement CSV ingestion webhook',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  csv: { type: 'string', description: 'Settlement CSV payload' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Ingestion summary' },
        },
      },
    },
    '/api/evidence': {
      get: {
        summary: 'Retrieve evidence bundle',
        parameters: [
          { name: 'abn', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'taxType', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'periodId', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Evidence bundle',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
    '/api/balance': {
      get: {
        summary: 'Retrieve ledger balance',
        parameters: [
          { name: 'abn', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'taxType', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'periodId', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Balance response' },
          '400': { description: 'Missing parameters' },
        },
      },
    },
    '/api/ledger': {
      get: {
        summary: 'Retrieve ledger entries',
        parameters: [
          { name: 'abn', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'taxType', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'periodId', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Ledger rows' },
          '400': { description: 'Missing parameters' },
        },
      },
    },
    '/api/deposit': {
      post: {
        summary: 'Deposit funds into ledger',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['abn', 'taxType', 'periodId', 'amountCents'],
                properties: {
                  abn: { type: 'string' },
                  taxType: { type: 'string' },
                  periodId: { type: 'string' },
                  amountCents: { type: 'integer', minimum: 1 },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Deposit accepted' },
          '400': { description: 'Validation error' },
        },
      },
    },
    '/api/release': {
      post: {
        summary: 'Release funds to ATO',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['abn', 'taxType', 'periodId', 'amountCents'],
                properties: {
                  abn: { type: 'string' },
                  taxType: { type: 'string' },
                  periodId: { type: 'string' },
                  amountCents: { type: 'integer' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Release executed' },
          '400': { description: 'Validation error' },
        },
      },
    },
  },
};

async function main() {
  const outputPath = path.resolve(__dirname, '..', 'public', 'openapi.json');
  await writeFile(outputPath, JSON.stringify(spec, null, 2));
  console.log(`OpenAPI spec written to ${outputPath}`);
}

main().catch((error) => {
  console.error('Failed to generate OpenAPI spec:', error);
  process.exitCode = 1;
});
