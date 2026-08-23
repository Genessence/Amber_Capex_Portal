import { describe, expect, it } from 'vitest';
import {
  FX_TO_INR,
  currencySymbol,
  formatCurrency,
  formatTypedInr,
  inrWithNative,
  inrWithNativeLabel,
  isForeignCurrency,
  toInr,
} from './currencyUtils';

describe('currencySymbol', () => {
  it('returns the symbol for a known currency', () => {
    expect(currencySymbol('INR')).toBe('₹');
    expect(currencySymbol('USD')).toBe('$');
    expect(currencySymbol('EUR')).toBe('€');
  });

  it('defaults to INR when nothing is passed', () => {
    expect(currencySymbol()).toBe('₹');
  });

  it('falls back to the bare code for an unknown currency rather than a wrong symbol', () => {
    expect(currencySymbol('AUD')).toBe('AUD ');
  });
});

describe('toInr', () => {
  it('is the identity for INR', () => {
    expect(toInr(80_00_000, 'INR')).toBe(80_00_000);
    expect(toInr(80_00_000)).toBe(80_00_000);
  });

  it('converts a foreign amount through the static table', () => {
    expect(toInr(1_00_000, 'USD')).toBe(1_00_000 * FX_TO_INR.USD);
  });

  it('leaves an unknown currency at 1:1 (never invents a rate)', () => {
    expect(toInr(1234, 'AUD')).toBe(1234);
  });
});

describe('isForeignCurrency', () => {
  it('is false for INR and for a missing currency', () => {
    expect(isForeignCurrency('INR')).toBe(false);
    expect(isForeignCurrency(undefined)).toBe(false);
    expect(isForeignCurrency('')).toBe(false);
  });

  it('is true for anything else', () => {
    expect(isForeignCurrency('USD')).toBe(true);
  });
});

describe('inrWithNative', () => {
  it('leaves a domestic amount with no second figure to show', () => {
    expect(inrWithNative(80_00_000, 'INR')).toEqual({
      inr: '₹80,00,000',
      native: null,
    });
  });

  it('defaults to INR when no currency is given', () => {
    expect(inrWithNative(1000).native).toBeNull();
  });

  it('converts a foreign amount for the INR figure and keeps the original alongside', () => {
    // The defect this guards: a $1,00,000 quote printed as "₹1,00,000" — 85x under its real value.
    const d = inrWithNative(1_00_000, 'USD');
    expect(d.inr).toBe('₹85,50,000');
    expect(d.native).toBe('$100,000 USD');
  });

  it('carries the currency code, so an unknown currency is not mistaken for rupees', () => {
    const d = inrWithNative(1000, 'AUD');
    expect(d.native).toBe('AUD 1,000 AUD');
    expect(d.inr).toBe('₹1,000');
  });

  it('never prints a foreign symbol on the INR figure', () => {
    for (const cur of Object.keys(FX_TO_INR)) {
      expect(inrWithNative(1000, cur).inr.startsWith('₹')).toBe(true);
    }
  });

  it('rounds rather than truncating', () => {
    expect(inrWithNative(1.6, 'INR').inr).toBe('₹2');
  });
});

describe('inrWithNativeLabel', () => {
  it('is the plain INR figure for a domestic amount', () => {
    expect(inrWithNativeLabel(80_00_000, 'INR')).toBe('₹80,00,000');
    expect(inrWithNativeLabel(80_00_000)).toBe('₹80,00,000');
  });

  it('brackets the vendor original after the INR figure', () => {
    expect(inrWithNativeLabel(1_00_000, 'USD')).toBe('₹85,50,000 ($100,000 USD)');
  });

  it('agrees with inrWithNative — one basis, two renderings', () => {
    const d = inrWithNative(50_000, 'EUR');
    expect(inrWithNativeLabel(50_000, 'EUR')).toBe(`${d.inr} (${d.native})`);
  });

  it('is NOT idempotent — re-feeding its own INR output would double-convert', () => {
    // Documents the trap the doc comment warns about: the guard is at the call site, not here.
    const once = toInr(1_00_000, 'USD');
    expect(inrWithNativeLabel(once, 'USD')).not.toBe(inrWithNativeLabel(1_00_000, 'USD'));
  });
});

describe('formatCurrency', () => {
  it('renders in the amount own currency by default', () => {
    expect(formatCurrency(1_00_000, 'USD')).toBe('$100,000');
    expect(formatCurrency(80_00_000, 'INR')).toBe('₹80,00,000');
  });

  it('converts and stamps ₹ under { convert: true }', () => {
    expect(formatCurrency(1_00_000, 'USD', { convert: true })).toBe('₹85,50,000');
  });
});

describe('formatTypedInr', () => {
  it('labels a typed amount as ₹ without converting it', () => {
    // The Final-Decision freight/packing/service boxes: typed by sourcing, INR by contract, and
    // summed with per-line award prices that are already INR. Converting here would be the bug.
    expect(formatTypedInr('120000')).toBe('₹1,20,000');
    expect(formatTypedInr(120000)).toBe('₹1,20,000');
  });

  it('agrees with the sibling Price (₹) rendering — same figure, same string', () => {
    expect(formatTypedInr('99000')).toBe('₹' + Number(99000).toLocaleString('en-IN'));
  });

  it('returns null for an empty field so the caller can render its own dash', () => {
    expect(formatTypedInr('')).toBeNull();
    expect(formatTypedInr(null)).toBeNull();
    expect(formatTypedInr(undefined)).toBeNull();
  });

  it('returns null rather than "₹NaN" for a non-numeric stored value', () => {
    // SourcingDecision.freight is a free-form string on the type, so junk is representable.
    expect(formatTypedInr('abc')).toBeNull();
    expect(formatTypedInr(Number.NaN)).toBeNull();
    expect(formatTypedInr(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('keeps a zero visible — 0 is a real answer, not an empty field', () => {
    expect(formatTypedInr('0')).toBe('₹0');
    expect(formatTypedInr(0)).toBe('₹0');
  });

  it('rounds like every other money renderer here', () => {
    expect(formatTypedInr('1.6')).toBe('₹2');
  });
});
