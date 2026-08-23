/**
 * Dependency-free day / percent formatters, shared by the pure KPI layer and the dashboards.
 *
 * These live in `src/lib` (no imports at all, so the vitest suite needs nothing) precisely so a
 * tile and the note that explains it cannot round differently: `components/dashboards/format.ts`
 * re-exports them for the React side, and `kpiRoutes.ts` uses them for the words it puts on the
 * filtered list. Money formatters stay in the dashboards' `format.ts` — nothing in `src/lib` prints
 * currency.
 */

/** `null` → em dash; anything under a day → `<1d`; otherwise whole days. */
export function fmtDays(n: number | null): string {
  if (n == null) return '—';
  if (n < 1) return '<1d';
  return `${Math.round(n)}d`;
}

export function fmtPct(n: number): string {
  return `${Math.round(n)}%`;
}
