'use client'

import { SECTION_GRID } from '@/lib/uiTokens'
import { cn } from '@/lib/utils'

/**
 * THE layout system for the role dashboards.
 *
 * Every dashboard used to stack full-bleed blocks with ad-hoc spacing, so four screens drifted into
 * four rhythms: prose ran 130+ characters per line, a card holding one `<select>` spanned 1340px,
 * bar charts rendered 1120px wide by 8px tall, and empty states — the NORMAL state of this portal
 * today — took 180px of vertical padding each. None of that is a per-file bug; it is the absence of
 * a grid. So the primitives live here, once, and the dashboards compose them:
 *
 * - `DashboardHeader` — page `<h1>` + a description capped at a readable measure, plus a slot for
 *   page-level filters (the Sourcing plant chips).
 * - `DashboardGrid` — the ONE responsive card grid. Cards in a row are equal height (grid stretch)
 *   and their content is top-aligned, so a short card next to a tall one reads as deliberate.
 * - `KpiGrid` — the tile row. 2-up on small, `cols`-up from `lg`.
 * - `EmptyState` — compact, quiet, and visibly a state rather than a broken card.
 * - `ChartFrame` — a width cap so a chart row reads as one object, keeping the per-chart
 *   `overflow-x-auto` so a narrow column scrolls the CHART, never the page.
 * - `PROSE` — the readable-measure cap for any explanatory sentence.
 *
 * Spacing comes from `uiTokens.ts` (`gap-4` / `p-4` / `p-5`) — no competing scale is introduced.
 *
 * ── THE TRACK RULE (2026-08, measured) ──
 *
 * **A row of N lands on the OUTER grid. N columns means N surfaces — never one padded card with an
 * N-column grid inside it.**
 *
 * A card's `p-4` insets its contents by 16px on each side, so an inner 4-column grid has tracks of
 * `(W - 32 - 3·gap) / 4` while a `KpiGrid` at panel width has `(W - 3·gap) / 4`. Stacked, the two
 * rows drift progressively — measured on Administration → Portfolio at 1440: the hero card's stats
 * started at 93 / 425 / 756 / 1088 while the tile row beneath started at 76 / 416 / 756 / 1096, and
 * the eye tracks those vertical edges, so a 17px miss reads as broken rather than as a different
 * card. The fix is structural, not a nudge: the four hero figures are four `KpiTile`s in the same
 * `KpiGrid`, and the four percentile cards on the Sourcing Performance tab are four cards in the
 * same `DashboardGrid` as the chart cards below them.
 *
 * So: put the group's heading in a `DashboardSection` WITHOUT `card`, and give each column its own
 * surface. `bodyClassName` on a section is for stacking (`space-y-4`), not for laying out columns —
 * use `DashboardGrid` / `KpiGrid` for that, or the next row of N will drift again.
 */

/**
 * Readable measure for explanatory prose. Every caption, footnote and disclosure on these screens is
 * a sentence someone has to READ, and a 1340px line is unreadable however correct it is. ~72ch is
 * the upper end of the classic 45–75ch band — wide enough that these long, deliberately precise
 * basis notes stay compact, narrow enough to track from line to line.
 */
export const PROSE = 'max-w-[72ch]'

/** Column counts the dashboards actually use. More than three cards abreast stops being readable. */
type GridCols = 1 | 2 | 3

const GRID_COLS: Record<GridCols, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 lg:grid-cols-2',
  3: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
}

/**
 * The card grid — every multi-column row of CARDS on these dashboards.
 *
 * `items-start`, not the grid default of `stretch`. Equal height reads as tidy only when the
 * contents are comparable; here they are data-dependent, and stretching manufactured real dead
 * space — measured at 1440: Administration → My Desk stretched a one-row "Your approvals" to its
 * three-row sibling's 212px (~100px of empty card), and the Portfolio tab's "Delivery TAT by plant"
 * (one bar) to its three-bar neighbour's 267px. A card that ends where its content ends is honest;
 * a card padded to match a neighbour looks like something failed to load. Tile rows are the
 * deliberate exception — see `KpiGrid`.
 */
export function DashboardGrid({
  cols = 2, children,
}: {
  cols?: GridCols
  children: React.ReactNode
}) {
  return (
    <div className={cn('grid items-start', GRID_COLS[cols], SECTION_GRID)}>
      {children}
    </div>
  )
}

/**
 * The KPI tile row. Always 2-up on small screens (a single column of tiles wastes a phone's width
 * and pushes the queues below the fold) and `cols`-up from `lg`.
 *
 * `items-stretch` here, unlike `DashboardGrid`: a tile row is ONE band of equal-weight figures, and
 * its slack is absorbed by the tile itself (the caption is bottom-aligned), so equal height buys
 * alignment rather than empty boxes.
 *
 * Baseline alignment across the row is the TILE's job, not the grid's — see `KpiTile`, whose label
 * row has a fixed height so every value in a row starts at the same y even when one label wraps.
 */
export function KpiGrid({
  cols = 4, className, children,
}: {
  cols?: 2 | 3 | 4
  className?: string
  children: React.ReactNode
}) {
  const lg = cols === 4 ? 'lg:grid-cols-4' : cols === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'
  return (
    <div className={cn('grid grid-cols-2 items-stretch', lg, SECTION_GRID, className)}>
      {children}
    </div>
  )
}

/**
 * An empty state, sized for a portal whose FY 2026-27 ships an empty Brown Field seed: "nothing
 * here yet" is the normal reading, not an error, so it gets a quiet dashed frame at ~40px of height
 * instead of 180px of blank card. The wording is always the caller's — every one of these sentences
 * says WHY a figure is absent, and that reasoning is never abbreviated to fit a smaller box.
 */
export function EmptyState({
  children, action,
}: {
  children: React.ReactNode
  /** An optional call to action (a link to where the first record is created). */
  action?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-slate-50/70 px-3 py-3 text-center">
      <p className={cn('text-xs text-slate-500 mx-auto', PROSE)}>{children}</p>
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  )
}

/** Width caps for charts. A bar chart wider than this stops reading as a row and becomes a rule. */
const FRAME_WIDTH = {
  sm: 'max-w-md',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  /**
   * No cap — for a chart that SIZES ITSELF to its container (`TrendChart` measures its width, so 1
   * viewBox unit is 1 CSS pixel). The caps above exist because a fixed-viewBox SVG scaled by
   * `w-full` grows taller and magnifies its labels as the column widens; a self-measuring chart has
   * neither problem, and capping it just leaves the card empty on the right.
   */
  full: 'max-w-none',
} as const

/**
 * Constrains a chart to a legible width while keeping its own horizontal scroll — the invariant
 * from the review: a narrow column must scroll the CHART, not the page. `min-w` is what makes that
 * scroll real rather than a crush.
 */
export function ChartFrame({
  size = 'md', minWidth = 280, children,
}: {
  size?: keyof typeof FRAME_WIDTH
  /** Below this the chart scrolls instead of compressing. */
  minWidth?: number
  children: React.ReactNode
}) {
  return (
    <div className={cn('overflow-x-auto', FRAME_WIDTH[size])}>
      <div style={{ minWidth }}>{children}</div>
    </div>
  )
}

/**
 * Page header: the `<h1>` every dashboard's heading outline hangs off, its description at a readable
 * measure, and an optional row of page-level controls beneath (the Sourcing plant chips, the notes
 * that disclose an ignored `?plant=`).
 *
 * `shrink-0` keeps it out of the flex column's scroll area — the header never scrolls away.
 */
export function DashboardHeader({
  title, description, children,
}: {
  title: string
  description: string
  /** Page-level filters and disclosures rendered under the description. */
  children?: React.ReactNode
}) {
  return (
    <header className="shrink-0 space-y-2">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">{title}</h1>
        <p className={cn('text-xs text-slate-500 mt-0.5', PROSE)}>{description}</p>
      </div>
      {children}
    </header>
  )
}
