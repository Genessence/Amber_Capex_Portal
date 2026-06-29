'use client';

import { useMemo, useState } from 'react';
import { FileText, IndianRupee, Activity, TrendingDown } from 'lucide-react';
import { useCapex } from '@/lib/capexContext';
import { STATUS_COLORS, STATUS_LABELS, PLANTS } from '@/lib/constants';
import { CARD, CARD_TIGHT } from '@/lib/uiTokens';
import type { CapexStatus } from '@/lib/types';

/* ── Formatters ─────────────────────────────────────────── */
function fmt(n: number) {
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(1)}Cr`;
  if (n >= 100_000)    return `₹${(n / 100_000).toFixed(1)}L`;
  return '₹' + n.toLocaleString('en-IN');
}
function fmtFull(n: number) { return '₹' + n.toLocaleString('en-IN'); }

/* ── Donut Chart ────────────────────────────────────────── */
interface DonutItem { label: string; value: number; color: string }
function DonutChart({ data }: { data: DonutItem[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <p className="text-sm text-slate-400 py-8 text-center">No requests yet.</p>;

  const R = 72, CX = 100, CY = 100, C = 2 * Math.PI * R;
  let cum = 0;

  const segs = data.filter(d => d.value > 0).map(d => {
    const pct = d.value / total;
    const seg = { ...d, pct, dash: `${pct * C} ${C}`, offset: -(cum * C), pctStr: `${Math.round(pct * 100)}%` };
    cum += pct;
    return seg;
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Donut */}
      <div className="flex justify-center">
        <svg viewBox="0 0 200 200" className="w-44 h-44" aria-label="requests by status">
          {/* background track */}
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="#f1f5f9" strokeWidth={28} />
          {segs.map((s, i) => (
            <circle key={i} cx={CX} cy={CY} r={R}
              fill="none" stroke={s.color} strokeWidth={28}
              strokeDasharray={s.dash} strokeDashoffset={s.offset}
              transform={`rotate(-90 ${CX} ${CY})`} />
          ))}
          {/* centre */}
          <text x={CX} y={CY - 8} textAnchor="middle" fontSize={30} fontWeight="800" fill="#0f172a">{total}</text>
          <text x={CX} y={CY + 14} textAnchor="middle" fontSize={11} letterSpacing="0.08em" fill="#94a3b8">REQUESTS</text>
        </svg>
      </div>

      {/* Legend — 2-col grid with % */}
      <div className="grid grid-cols-2 gap-1.5">
        {segs.map(s => (
          <div key={s.label} className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1.5">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
            <span className="text-xs text-slate-600 truncate flex-1 min-w-0">{s.label}</span>
            <span className="text-xs font-bold text-slate-800 shrink-0">{s.value}</span>
            <span className="text-[10px] text-slate-400 shrink-0 w-8 text-right">{s.pctStr}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Horizontal Bar Chart (Requests by Plant) ───────────── */
interface HBarItem { label: string; sub?: string; value: number }
function HBarChart({ data, emptyText = 'No data.' }: { data: HBarItem[]; emptyText?: string }) {
  if (!data.length) return <p className="text-sm text-slate-400 py-8 text-center">{emptyText}</p>;
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const max    = Math.max(...sorted.map(d => d.value), 1);
  const total  = sorted.reduce((s, d) => s + d.value, 0);

  return (
    <div className="space-y-3.5">
      {sorted.map(d => {
        const barPct   = Math.round((d.value / max) * 100);
        const sharePct = total > 0 ? Math.round((d.value / total) * 100) : 0;
        return (
          <div key={d.label}>
            <div className="flex items-baseline justify-between mb-1.5 gap-2">
              <p className="text-sm font-semibold text-slate-800 truncate">
                {d.label}
                {d.sub && <span className="ml-1.5 text-xs font-normal text-slate-400">{d.sub}</span>}
              </p>
              <p className="text-sm font-bold text-slate-700 shrink-0 tabular-nums">
                {d.value}
                <span className="ml-1 text-xs font-normal text-slate-400">({sharePct}%)</span>
              </p>
            </div>
            <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-[#0D9488] rounded-full transition-[width] duration-300"
                style={{ width: `${barPct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Savings Breakdown ──────────────────────────────────── */
interface SavingsEntry { id: string; subject: string; budget: number; finalCost: number; saving: number }
function SavingsBreakdown({ entries }: { entries: SavingsEntry[] }) {
  const maxBudget = Math.max(...entries.map(e => e.budget), 1);
  return (
    <div className="space-y-4">
      {entries.sort((a, b) => b.saving - a.saving).map(e => {
        const costW    = Math.round((e.finalCost / e.budget) * 100);
        const savePct  = Math.round((e.saving / e.budget) * 100);
        const budgetW  = Math.round((e.budget / maxBudget) * 100);
        return (
          <div key={e.id}>
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <p className="text-sm font-semibold text-slate-800 truncate">{e.subject}</p>
              <p className="text-sm font-black text-emerald-600 shrink-0">
                -{savePct}% <span className="text-xs font-semibold text-emerald-500">({fmt(e.saving)} saved)</span>
              </p>
            </div>
            {/* proportional track */}
            <div className="relative h-5 bg-slate-100 rounded-full overflow-hidden" style={{ width: `${budgetW}%` }}>
              {/* paid portion */}
              <div className="absolute inset-y-0 left-0 bg-slate-300 rounded-l-full"
                style={{ width: `${costW}%` }} />
              {/* saved portion */}
              <div className="absolute inset-y-0 right-0 bg-emerald-400 rounded-r-full"
                style={{ width: `${100 - costW}%` }} />
            </div>
            <div className="flex gap-4 mt-1.5 text-xs text-slate-400">
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-slate-300" />
                Paid {fmtFull(e.finalCost)}
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-400" />
                Saved {fmtFull(e.saving)}
              </span>
              <span className="ml-auto text-slate-300">Budget {fmtFull(e.budget)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Status colours (hex for SVG) ───────────────────────── */
const STATUS_HEX: Record<string, string> = {
  draft:                 '#94a3b8',
  submitted:             '#60a5fa',
  pending_head_approval: '#fb923c',
  sourcing:              '#a78bfa',
  negotiation:           '#fbbf24',
  sourcing_approved:     '#f59e0b',
  buyer_approved:        '#22c55e',
  rejected:              '#f87171',
};
const ORDERED_STATUSES: CapexStatus[] = [
  'draft','submitted','pending_head_approval','sourcing',
  'negotiation','sourcing_approved','buyer_approved','rejected',
];

/* ── Page ───────────────────────────────────────────────── */
export default function DashboardPage() {
  const { requests, invites, capexMaster } = useCapex();
  const [plantFilter, setPlantFilter] = useState<string>('all');

  const filtered = useMemo(
    () => plantFilter === 'all' ? requests : requests.filter(r => r.plant === plantFilter),
    [requests, plantFilter],
  );

  const stats = useMemo(() => {
    const totalBudget    = filtered.reduce((s, r) => s + (r.budget ?? 0), 0);
    const activeRequests = filtered.filter(r => !['buyer_approved','rejected','draft'].includes(r.status)).length;
    const completed      = filtered.filter(r => r.status === 'buyer_approved').length;

    const byStatus = filtered.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1; return acc;
    }, {});

    const byPlant = PLANTS.map(p => ({
      label: p.label, sub: p.state,
      value: filtered.filter(r => r.plant === p.value).length,
    })).filter(p => p.value > 0);

    const savingsEntries: SavingsEntry[] = filtered
      .filter(r => r.status === 'buyer_approved')
      .flatMap(r => {
        const inv = invites.find(i => i.requestId === r.id && i.status === 'approved');
        if (!inv || !inv.quotes.length || !r.budget) return [];
        const q = inv.quotes[inv.quotes.length - 1];
        const finalCost = q.price + (q.freight ?? 0) + (q.packing ?? 0) + (q.service ?? 0);
        const saving = r.budget - finalCost;
        return saving > 0 ? [{ id: r.id, subject: r.subject, budget: r.budget, finalCost, saving }] : [];
      });
    const totalSavings = savingsEntries.reduce((s, e) => s + e.saving, 0);

    const donutData = ORDERED_STATUSES
      .filter(s => byStatus[s])
      .map(s => ({ label: STATUS_LABELS[s] ?? s, value: byStatus[s] ?? 0, color: STATUS_HEX[s] ?? '#94a3b8' }));

    const recent = [...filtered]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 6);

    return { totalBudget, activeRequests, completed, savingsEntries, totalSavings, donutData, byPlant, recent };
  }, [filtered, invites]);

  return (
    <div className="p-5 h-full flex flex-col space-y-4">

      {/* Header + plant filter */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">Capital expenditure overview</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {(['all', ...PLANTS.map(p => p.value)] as string[]).map(v => {
            const label  = v === 'all' ? 'All Plants' : PLANTS.find(p => p.value === v)?.label ?? v;
            const active = plantFilter === v;
            return (
              <button key={v} onClick={() => setPlantFilter(v)}
                className={`px-3 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-[#153f90] text-white border-[#153f90]'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-[#5B82D4] hover:text-[#153f90]'
                }`}
              >{label}</button>
            );
          })}
        </div>
      </div>

      {/* KPI cards — number is the hero */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          {
            label: 'Total Requests', value: String(filtered.length),
            sub: `${stats.completed} completed`,
            accent: '#6366f1', icon: FileText,
          },
          {
            label: 'Total Budget', value: fmt(stats.totalBudget),
            sub: fmtFull(stats.totalBudget),
            accent: '#3b82f6', icon: IndianRupee,
          },
          {
            label: 'Active Requests', value: String(stats.activeRequests),
            sub: 'in progress now',
            accent: '#8b5cf6', icon: Activity,
          },
          {
            label: 'Negotiated Savings', value: fmt(stats.totalSavings),
            sub: stats.savingsEntries.length ? `across ${stats.savingsEntries.length} request${stats.savingsEntries.length > 1 ? 's' : ''}` : 'no savings recorded',
            accent: '#10b981', icon: TrendingDown,
          },
        ].map(({ label, value, sub, accent, icon: Icon }) => (
          <div key={label}
            className={`${CARD_TIGHT} flex flex-col gap-1.5 relative overflow-hidden`}>
            {/* left accent bar */}
            <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl" style={{ background: accent }} />
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
              <div className="rounded-lg p-1.5" style={{ background: accent + '18' }}>
                <Icon className="w-4 h-4" style={{ color: accent }} />
              </div>
            </div>
            <div>
              <p className="text-2xl font-black tracking-tight text-slate-900 leading-none">{value}</p>
              <p className="text-xs text-slate-400 mt-1">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* CAPEX Master KPI strip */}
      {(() => {
        const currentFy = capexMaster.length
          ? capexMaster.slice().sort((a, b) => b.fy.localeCompare(a.fy))[0].fy
          : null
        const fyItems = currentFy ? capexMaster.filter(i => i.fy === currentFy) : []
        if (!fyItems.length) return null
        const totalAllocatedCr = fyItems.reduce((s, i) => s + i.totalCost, 0)
        // committed = budget of non-rejected requests in Cr (₹ / 1_00_00_000)
        const committedCr = requests
          .filter(r => r.status !== 'rejected' && r.budget)
          .reduce((s, r) => s + (r.budget ?? 0) / 1_00_00_000, 0)
        const remainingCr = totalAllocatedCr - committedCr
        const utilisationPct = totalAllocatedCr > 0 ? Math.round((committedCr / totalAllocatedCr) * 100) : 0
        return (
          <div className={CARD}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">CAPEX Master — FY {currentFy}</p>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${utilisationPct > 90 ? "bg-red-50 text-red-700" : utilisationPct > 70 ? "bg-orange-50 text-orange-700" : "bg-emerald-50 text-emerald-700"}`}>
                {utilisationPct}% utilised
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Allocated Budget", value: `${totalAllocatedCr.toFixed(2)} Cr`, color: "text-slate-800" },
                { label: "Committed",        value: `${committedCr.toFixed(2)} Cr`,      color: "text-[#0D9488]" },
                { label: "Remaining",        value: `${remainingCr.toFixed(2)} Cr`,      color: remainingCr >= 0 ? "text-emerald-700" : "text-red-700" },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex items-baseline gap-1.5 min-w-0">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider shrink-0">{label}:</p>
                  <p className={`text-lg font-black tabular-nums truncate ${color}`}>{value}</p>
                </div>
              ))}
            </div>
            {/* utilisation bar */}
            <div className="mt-3 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-[width] duration-300 ${utilisationPct > 90 ? "bg-red-500" : utilisationPct > 70 ? "bg-[#0D9488]" : "bg-emerald-500"}`}
                style={{ width: `${Math.min(utilisationPct, 100)}%` }}
              />
            </div>
          </div>
        )
      })()}

      <div className="flex-1 min-h-0 overflow-y-auto space-y-4">

      {/* Row 2 — Status donut + Plant bars */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className={CARD}>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">Requests by Status</p>
          <DonutChart data={stats.donutData} />
        </div>

        <div className={CARD}>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">Requests by Plant</p>
          <HBarChart data={stats.byPlant} emptyText="No plant data yet." />
        </div>
      </div>

      {/* Row 3 — Money saved */}
      {stats.savingsEntries.length > 0 && (
        <div className={CARD}>
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Money Saved</p>
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-700">
              <TrendingDown className="w-3.5 h-3.5" />
              {fmtFull(stats.totalSavings)} total
            </span>
          </div>
          <SavingsBreakdown entries={stats.savingsEntries} />
        </div>
      )}

      {/* Row 4 — Recent requests */}
      <div className={CARD}>
        <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">Recent Requests</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                {['Subject','Plant','Category','Status'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-slate-400 pb-2.5 pr-4 last:pr-0">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.recent.map((req, idx) => (
                <tr key={req.id} className={`border-b border-slate-100 last:border-0 transition-colors hover:bg-[#EBF0FB]/60 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
                  <td className="py-2 pr-4 font-semibold text-slate-800 max-w-[180px] truncate">{req.subject}</td>
                  <td className="py-2 pr-4 text-slate-500">{req.plant ? (PLANTS.find(p => p.value === req.plant)?.label ?? req.plant) : '—'}</td>
                  <td className="py-2 pr-4 text-slate-500">{req.category}</td>
                  <td className="py-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[req.status] ?? 'bg-slate-100 text-slate-600'}`}>
                      {STATUS_LABELS[req.status as CapexStatus] ?? req.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      </div>{/* end flex-1 scroll wrapper */}
    </div>
  );
}
