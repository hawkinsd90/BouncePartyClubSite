import { describe, it, expect } from 'vitest';
import { calculateEventEssentialsSetupFeeCents, EVENT_ESSENTIALS_SETUP_MINIMUM_CENTS } from './setupFeeCalculation';

describe('calculateEventEssentialsSetupFeeCents', () => {
  it('returns 0 when no items (EE subtotal <= 0)', () => {
    expect(calculateEventEssentialsSetupFeeCents({ hasInflatables: false, eventEssentialsSubtotalCents: 0 })).toBe(0);
  });

  it('returns $55 for $95 EE Generator, no inflatable', () => {
    expect(calculateEventEssentialsSetupFeeCents({ hasInflatables: false, eventEssentialsSubtotalCents: 9500 })).toBe(5500);
  });

  it('returns $50 for $100 EE, no inflatable', () => {
    expect(calculateEventEssentialsSetupFeeCents({ hasInflatables: false, eventEssentialsSubtotalCents: 10000 })).toBe(5000);
  });

  it('returns $0 for $150 EE, no inflatable', () => {
    expect(calculateEventEssentialsSetupFeeCents({ hasInflatables: false, eventEssentialsSubtotalCents: 15000 })).toBe(0);
  });

  it('returns $0 for $151 EE, no inflatable', () => {
    expect(calculateEventEssentialsSetupFeeCents({ hasInflatables: false, eventEssentialsSubtotalCents: 15100 })).toBe(0);
  });

  it('returns $0 when inflatable present + $95 EE', () => {
    expect(calculateEventEssentialsSetupFeeCents({ hasInflatables: true, eventEssentialsSubtotalCents: 9500 })).toBe(0);
  });

  it('returns $0 for package at $150', () => {
    expect(calculateEventEssentialsSetupFeeCents({ hasInflatables: false, eventEssentialsSubtotalCents: 15000 })).toBe(0);
  });

  it('returns $50 for package at $100', () => {
    expect(calculateEventEssentialsSetupFeeCents({ hasInflatables: false, eventEssentialsSubtotalCents: 10000 })).toBe(5000);
  });

  it('threshold constant is 15000', () => {
    expect(EVENT_ESSENTIALS_SETUP_MINIMUM_CENTS).toBe(15000);
  });

  it('handles negative EE subtotal safely', () => {
    expect(calculateEventEssentialsSetupFeeCents({ hasInflatables: false, eventEssentialsSubtotalCents: -100 })).toBe(0);
  });

  it('handles NaN safely', () => {
    expect(calculateEventEssentialsSetupFeeCents({ hasInflatables: false, eventEssentialsSubtotalCents: NaN })).toBe(0);
  });

  it('truncates fractional cents', () => {
    expect(calculateEventEssentialsSetupFeeCents({ hasInflatables: false, eventEssentialsSubtotalCents: 9999.99 })).toBe(5001);
  });
});
