/**
 * Currency + FX helpers. The portal stores each quote's amount in the vendor's chosen currency
 * (a plain number + a currency code) — there is no live FX feed, so we convert to INR through a
 * static rate table maintained here in code (not surfaced in the UI). Sourcing surfaces show the
 * INR value with the original foreign amount alongside; everything else defaults to INR.
 *
 * Rates are indicative "current" values (mid-2026) — update here if they drift materially.
 */
export const FX_TO_INR: Record<string, number> = {
  INR: 1,
  USD: 85.5,
  EUR: 93,
  GBP: 108,
  JPY: 0.58,
  CNY: 11.9,
};

export const CURRENCY_SYMBOL: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
};

export function currencySymbol(currency = 'INR'): string {
  return CURRENCY_SYMBOL[currency] ?? (currency ? `${currency} ` : '');
}

/** True for a convertible non-INR currency. */
export function isForeignCurrency(currency?: string): boolean {
  return !!currency && currency !== 'INR';
}

/** Convert an amount in `currency` to INR using the static rate table. Unknown currency → 1:1. */
export function toInr(amount: number, currency = 'INR'): number {
  const rate = FX_TO_INR[currency] ?? 1;
  return amount * rate;
}

/**
 * Format a money amount.
 * - default: render in the amount's OWN currency (symbol + grouped digits).
 * - { convert: true }: convert to INR first and render as ₹ (used on sourcing surfaces that
 *   standardise on INR with the original foreign amount shown alongside).
 */
export function formatCurrency(amount: number, currency = 'INR', opts?: { convert?: boolean }): string {
  const converting = !!opts?.convert;
  const value = converting ? toInr(amount, currency) : amount;
  const sym = converting ? '₹' : currencySymbol(currency);
  const locale = converting || currency === 'INR' ? 'en-IN' : 'en-US';
  return sym + Math.round(value).toLocaleString(locale);
}
