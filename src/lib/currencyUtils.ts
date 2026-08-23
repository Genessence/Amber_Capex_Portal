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

/** An amount rendered on both bases: the INR comparison figure, and the vendor's own currency. */
export interface InrDisplay {
  /** The amount converted to INR and rendered under `₹` — the cross-vendor comparison basis. */
  inr: string;
  /** The SAME amount in the vendor's own currency (`$1,00,000 USD`), or null when it is already INR. */
  native: string | null;
}

/**
 * The portal's one rule for showing a vendor's money: the INR figure leads (that is the basis every
 * comparison, threshold, award and PO is built on), with the vendor's own-currency figure alongside
 * so the quotation on file is still recognisable.
 *
 * `amount` MUST be the vendor's OWN-CURRENCY figure. Passing an already-converted INR number with a
 * foreign `currency` converts it a second time and is silent — `toInr(x, 'INR')` is the identity, so
 * a double conversion never announces itself. Trace the value to its source before calling this:
 * `inrRfqTotal`, `inrQuoteGrandTotal`, `lowestRfqTotal` and `awardUnitPriceInr` are ALREADY INR and
 * must be printed with plain `₹`, not through here.
 */
export function inrWithNative(amount: number, currency = 'INR'): InrDisplay {
  return {
    inr: formatCurrency(amount, currency, { convert: true }),
    native: isForeignCurrency(currency) ? `${formatCurrency(amount, currency)} ${currency}` : null,
  };
}

/**
 * Single-line form of {@link inrWithNative}: `₹85,50,000 ($100,000 USD)`, or plain `₹85,50,000`
 * for a domestic quote. For table cells and option labels that can only hold a string.
 */
export function inrWithNativeLabel(amount: number, currency = 'INR'): string {
  const { inr, native } = inrWithNative(amount, currency);
  return native ? `${inr} (${native})` : inr;
}

/**
 * Render a money amount a user TYPED into an INR-by-contract field — today the Final-Decision
 * column's freight / packing / service boxes in the comparison grid.
 *
 * These are NOT converted, because there is no source currency to convert from: sourcing types them
 * directly, and their consumers (`computeFinalTotal` on `/capex/requests`, `SourcingDecisionBanner`
 * on `/capex/[id]`) add them straight to the per-line award prices that `awardUnitPriceInr` already
 * stored in INR, then print the sum under ₹. So they are LABELLED ₹, never re-based — the same
 * treatment the sibling `Price (₹)` box in that column gets.
 *
 * Returns null for an empty / non-numeric field so the caller renders its own placeholder rather
 * than "₹NaN" (`SourcingDecision.freight` and friends are stored as free-form strings).
 */
export function formatTypedInr(raw: string | number | null | undefined): string | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return formatCurrency(n, 'INR');
}
