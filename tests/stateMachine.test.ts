import { describe, it } from 'node:test';
import assert from 'node:assert';

import { nextState, PeriodState } from '../src/recon/stateMachine';

describe('nextState', () => {
  const scenarios: Array<{ current: PeriodState; evt: string; expected: PeriodState }> = [
    { current: 'OPEN', evt: 'CLOSE', expected: 'CLOSING' },
    { current: 'CLOSING', evt: 'PASS', expected: 'READY_RPT' },
    { current: 'CLOSING', evt: 'FAIL_DISCREPANCY', expected: 'BLOCKED_DISCREPANCY' },
    { current: 'CLOSING', evt: 'FAIL_ANOMALY', expected: 'BLOCKED_ANOMALY' },
    { current: 'READY_RPT', evt: 'RELEASED', expected: 'RELEASED' },
    { current: 'RELEASED', evt: 'FINALIZE', expected: 'FINALIZED' },
  ];

  for (const { current, evt, expected } of scenarios) {
    it(`transitions ${current} + ${evt} -> ${expected}`, () => {
      assert.strictEqual(nextState(current, evt), expected);
    });
  }

  it('returns current state when transition is not defined', () => {
    assert.strictEqual(nextState('OPEN', 'UNKNOWN'), 'OPEN');
    assert.strictEqual(nextState('READY_RPT', 'PASS'), 'READY_RPT');
  });
});
