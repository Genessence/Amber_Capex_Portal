import type { CapexMasterItem } from './types';

/**
 * Bump when Brown Field seed changes — triggers one-time localStorage migration that replaces
 * stored Brown Field master rows with this array.
 *
 * Cleared 2026-07-29 (`fy2026_27_cleared`) so FY 2026-27 can be authored from a blank Budget
 * Proposal. Worked examples for the Excel import template live in `bulkMasterImport.ts`
 * (Jhajjar Plant 1 FALLBACK_SAMPLES). Regenerate via `npm run generate:brownfield-seed` when a
 * new workbook is ready.
 */
export const BROWNFIELD_SEED_VERSION = 'fy2026_27_cleared';

/** FY Brown Field RAC plant master — currently empty (rebuild via Budget Planning). */
export const brownFieldSeedData: CapexMasterItem[] = [];
