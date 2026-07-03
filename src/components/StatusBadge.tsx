import { STATUS_COLORS, STATUS_LABELS, STATUS_ICONS } from "@/lib/constants"
import { cn } from "@/lib/utils"

/**
 * Canonical request-status pill for the black-and-white theme. Since colour no longer
 * carries meaning, every badge pairs a monochrome fill (white-outline → light → dark →
 * black, with red reserved for danger) with a Lucide icon so the state still reads at a
 * glance. Use this everywhere a request status is shown rather than re-deriving spans.
 */
export function StatusBadge({
  status,
  size = "sm",
  className,
}: {
  status: string
  size?: "xs" | "sm"
  className?: string
}) {
  const Icon = STATUS_ICONS[status]
  const tone = STATUS_COLORS[status] ?? "bg-slate-100 text-slate-600 border border-slate-200"
  const label = STATUS_LABELS[status] ?? status
  const sizeCls =
    size === "xs"
      ? "text-[10px] px-1.5 py-0.5 gap-1"
      : "text-[11px] px-2 py-0.5 gap-1.5"
  const iconCls = size === "xs" ? "w-3 h-3" : "w-3.5 h-3.5"
  return (
    <span
      className={cn(
        "inline-flex items-center font-semibold rounded-full whitespace-nowrap",
        sizeCls,
        tone,
        className,
      )}
    >
      {Icon && <Icon className={cn(iconCls, "shrink-0")} strokeWidth={2.25} aria-hidden />}
      {label}
    </span>
  )
}
