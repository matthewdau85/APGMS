import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

function loadValidators() {
  return import('../src/rails/validators.js');
}

describe('rail validators', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.ALLOWLIST_ABNS = '12345678901,98765432109';
    process.env.ALLOWLIST_BSB_REGEX = '^\\d{3}-?\\d{3}$';
    process.env.ALLOWLIST_CRN_REGEX = '^\\d{8,10}$';
  });

  afterEach(() => {
    delete process.env.ALLOWLIST_ABNS;
    delete process.env.ALLOWLIST_BSB_REGEX;
    delete process.env.ALLOWLIST_CRN_REGEX;
  });

  test('rejects ABN not in allow-list', async () => {
    const { assertABNAllowed } = await loadValidators();
    expect(() => assertABNAllowed('11111111111')).toThrowErrorMatchingInlineSnapshot(`"abn is not allowlisted"`);
  });

  test('rejects invalid BSB format', async () => {
    const { assertBSB } = await loadValidators();
    expect(() => assertBSB('12345')).toThrowErrorMatchingInlineSnapshot(`"bsb failed validation"`);
  });

  test('rejects invalid CRN format', async () => {
    const { assertCRN } = await loadValidators();
    expect(() => assertCRN('abc123')).toThrowErrorMatchingInlineSnapshot(`"crn failed validation"`);
  });
});
