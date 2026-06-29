/**
 * Canonical UI density + surface tokens for the internal portal. Single source of truth for the
 * "moderate compact" rhythm so pages stop drifting (page padding, section gaps, card/table styling).
 * Mirrors the string-export pattern in `auctionTheme.ts`. Brand literals kept: navy #1E3A5F header,
 * teal #0D9488 accent, soft table surface #F0F4FB. Prefer semantic tokens (bg-card/border-border)
 * where they read identically to the old white/slate surfaces.
 *
 * Moderate-density baseline (vs the previous loose values):
 *   page padding   p-6   -> p-5
 *   section gap    space-y-6 / gap-6 -> space-y-4 / gap-4
 *   card padding   p-5/p-6 -> p-4   (rounded-2xl -> rounded-xl on dense internal cards)
 *   table row      py-4 (tallest) -> py-2 (read-only data rows; input cells stay py-3)
 *   meta grid      gap-x-8 gap-y-4 -> gap-x-6 gap-y-3
 */

/** Full-height data/table page shell (was `p-6 h-full flex flex-col`). */
export const PAGE_SHELL = "p-5 h-full flex flex-col";

/** Stacked content page shell (was `p-6 space-y-6`). */
export const PAGE_STACK = "p-5 space-y-4";

/** Vertical gap between major sections (was `space-y-6`). */
export const SECTION_GAP = "space-y-4";

/** Grid gap for card/stat grids (was `gap-5`/`gap-6`). */
export const SECTION_GRID = "gap-4";

/** Standard dense internal card surface (was `p-5`/`p-6`, rounded-2xl, slate borders). */
export const CARD = "bg-card rounded-xl border border-border shadow-sm p-4";

/** Tighter card variant for data-dense panels. */
export const CARD_TIGHT = "bg-card rounded-xl border border-border shadow-sm p-3.5";

/** Card header row. */
export const CARD_HEAD = "px-4 py-3 border-b border-border";

/** Scroll wrapper for wide tables (keeps columns from crushing). */
export const TABLE_WRAP = "overflow-x-auto rounded-lg border border-border";

/** Navy table header (matches the sourcing RfqPanel grid). */
export const TABLE_HEAD = "bg-[#1E3A5F] text-white text-[10px] font-bold uppercase tracking-wider";

/** Soft table header (light surface, for read/entry summary tables). */
export const TABLE_HEAD_SOFT =
  "bg-[#F0F4FB] border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider";

/** Header cell (~py-2 — aggressive read-only density). */
export const TH_CELL = "px-3 py-2 text-left";

/** Standardized read-only data row cell (~py-2 — aggressive density). */
export const TD_CELL = "px-3 py-2";

/**
 * Editable input-grid cell — INTENTIONALLY taller than the read-only `TD_CELL` rhythm.
 * Density EXCEPTION: cells that wrap a live <input>/<select> (the capex/new line grid and the
 * master inline editor) keep a roomier vertical pad so the control + its focus ring stay
 * comfortable and don't visually crush. The line grid uses `py-3` cells; the master inline
 * editor keeps its compact `py-0.5` field padding inside `py-2.5` cells. Do NOT "compact" these
 * to match read-only tables in a future density pass — the extra room is by design.
 */
export const TD_CELL_INPUT = "px-3 py-3";

/** Metadata key/value grid (was `gap-x-8 gap-y-4`). */
export const META_GRID = "grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3";

/** Public-facing vendor "hero" card — kept a touch more generous than internal cards. */
export const SUPPLIER_CARD = "bg-card border border-border rounded-2xl shadow-sm p-5 sm:p-7";

/** Brand accent literals (no semantic token exists for these yet — keep as-is). */
export const NAVY = "#1E3A5F";
export const TEAL = "#0D9488";
export const TABLE_SURFACE = "#F0F4FB";
