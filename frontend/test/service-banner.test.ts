import { describe, expect, it } from 'vitest';
import { isServiceDown } from '../src/lib/serviceStatus';

describe('P11 · isServiceDown', () => {
  it('treats a network/transport failure as an outage', () => {
    expect(isServiceDown({ networkError: true })).toBe(true);
    expect(isServiceDown({ networkError: true, status: 200 })).toBe(true);
  });

  it.each([500, 502, 503])('treats HTTP %i as an outage', (status) => {
    expect(isServiceDown({ status })).toBe(true);
    expect(isServiceDown({ status, networkError: false })).toBe(true);
  });

  it.each([200, 400, 413, 429])('keeps HTTP %i as an inline error, not an outage', (status) => {
    expect(isServiceDown({ status })).toBe(false);
  });

  it('defaults to not-down when no signal is present', () => {
    expect(isServiceDown({})).toBe(false);
    expect(isServiceDown({ networkError: false })).toBe(false);
  });
});
