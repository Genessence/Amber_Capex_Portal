'use client'

import { Shield, FileWarning, FileText, ThumbsUp, ThumbsDown, ScrollText } from 'lucide-react'
import type { DocApprovalPackage } from '@/lib/types'
import { SUPPLIER_CARD } from '@/lib/uiTokens'

function fmt(n: number) {
  return '₹' + n.toLocaleString('en-IN')
}

/**
 * Presentational review of a document-approval package (PBG + DLC + one-time payment terms).
 * Used on the supplier portal for the RFQ flow; auction approval renders these inline.
 */
export function DocPackageReview({
  pkg,
  onApprove,
  onReject,
  readOnly,
}: {
  pkg: DocApprovalPackage
  onApprove?: () => void
  onReject?: () => void
  readOnly?: boolean
}) {
  return (
    <div className={`${SUPPLIER_CARD} max-w-2xl mx-auto space-y-5`}>
      <div className="flex items-center gap-2">
        <ScrollText className="w-5 h-5 text-[#2563EB]" />
        <h2 className="text-lg font-bold text-slate-900">Approval Documents</h2>
      </div>
      <p className="text-sm text-slate-600">
        Please review and accept the following terms before this requirement proceeds.
      </p>

      {pkg.revisionNote && (
        <div className="text-xs bg-slate-50 border border-slate-200 text-slate-800 rounded-lg px-3 py-2">
          Revised: {pkg.revisionNote}
        </div>
      )}

      {pkg.termsText && (
        <Section icon={<FileText className="w-4 h-4 text-slate-500" />} title="Commercial Terms">
          {pkg.termsText}
        </Section>
      )}
      {pkg.performanceBankGuaranteeText && (
        <Section icon={<Shield className="w-4 h-4 text-slate-600" />} title="Performance Bank Guarantee">
          {pkg.performanceBankGuaranteeText}
        </Section>
      )}
      {pkg.delayLiabilityClauseText && (
        <Section icon={<FileWarning className="w-4 h-4 text-red-500" />} title="Delay Liability Clause">
          {pkg.delayLiabilityClauseText}
        </Section>
      )}
      {pkg.paymentTermsText && (
        <Section icon={<FileText className="w-4 h-4 text-slate-600" />} title="Payment Terms">
          <p>{pkg.paymentTermsText}</p>
          {pkg.paymentSplits?.length ? (
            <ul className="mt-2 space-y-1">
              {pkg.paymentSplits.map(s => (
                <li key={s.id} className="flex justify-between text-xs">
                  <span>{s.label}{s.trigger ? ` (${s.trigger})` : ''}</span>
                  <span className="font-semibold">{s.percent}%</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
      )}
      {pkg.extraDocs?.map(d => (
        <Section key={d.id} icon={<FileText className="w-4 h-4 text-slate-600" />} title={d.title}>
          {d.text}
        </Section>
      ))}

      {!readOnly && (onApprove || onReject) && (
        <div className="flex flex-col sm:flex-row gap-3 pt-1">
          {onApprove && (
            <button onClick={onApprove}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-slate-600 hover:bg-slate-700 text-white font-semibold py-2.5 min-h-[44px]">
              <ThumbsUp className="w-4 h-4" /> Accept Documents
            </button>
          )}
          {onReject && (
            <button onClick={onReject}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-white border border-red-200 text-red-600 hover:bg-red-50 font-semibold py-2.5 min-h-[44px]">
              <ThumbsDown className="w-4 h-4" /> Decline
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="flex items-center gap-1.5 text-sm font-bold text-slate-800 mb-1.5">{icon} {title}</p>
      <div className="text-sm text-slate-600 leading-relaxed">{children}</div>
    </div>
  )
}

export { fmt as formatPackageAmount }
