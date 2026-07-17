'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  CheckCircle2,
  XCircle,
  Wallet,
  FileText,
  Upload,
  Send,
  Clock,
  Hash,
  Building2,
} from 'lucide-react'
import { useCapex } from '@/lib/capexContext'
import { resolvePoTarget } from '@/lib/tokenUtils'
import { SUPPLIER_CARD } from '@/lib/uiTokens'
import { FIELD_TYPE_LABELS } from '@/lib/types'
import { PLANTS, STATUS_LABELS } from '@/lib/constants'
import { buildMilestonesFromVendor } from '@/lib/paymentUtils'
import type { PurchaseOrder } from '@/lib/types'

const MAX_PO_DOC_BYTES = 500 * 1024
const MAX_PO_DOCS = 8
const PO_DOC_ACCEPT =
  '.pdf,.png,.jpg,.jpeg,.xlsx,.doc,.docx,application/pdf,image/png,image/jpeg,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/msword,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const fmt = (n: number) => '₹' + n.toLocaleString('en-IN')

type PoDocDraft = { id: string; base64: string; name: string; mimeType: string }

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-900 to-black flex flex-col">
      <header className="px-5 py-4 border-b border-white/10">
        <div className="max-w-2xl mx-auto flex items-center gap-2 text-white">
          <Wallet className="w-5 h-5 text-blue-400" />
          <span className="font-bold tracking-tight">Amber CAPEX</span>
          <span className="text-white/50 text-sm">· Global Accounts — Issue PO</span>
        </div>
      </header>
      <main className="flex-1 px-4 py-8">
        <div className="max-w-2xl mx-auto">{children}</div>
      </main>
    </div>
  )
}

function Terminal({ icon, title, note }: { icon: React.ReactNode; title: string; note: string }) {
  return (
    <div className={SUPPLIER_CARD}>
      <div className="flex flex-col items-center text-center gap-3 py-4">
        {icon}
        <h1 className="text-lg font-bold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground max-w-sm">{note}</p>
      </div>
    </div>
  )
}

export default function PoIssuePage() {
  const params = useParams()
  const token = String(params.token ?? '')
  const { requests, invites, vendors, loaded, issuePurchaseOrder } = useCapex()
  const [done, setDone] = useState(false)
  const [trialOnRequest, setTrialOnRequest] = useState(false)

  const target = useMemo(
    () => resolvePoTarget(token, requests, invites),
    [token, requests, invites],
  )

  const request = target?.request
  const invite = target?.kind === 'award' ? target.invite : undefined
  const vendor = useMemo(() => {
    if (!target) return undefined
    if (target.kind === 'award') return vendors.find(v => v.id === target.invite.vendorId)
    const reqInvites = invites.filter(i => i.requestId === target.request.id)
    const pick =
      reqInvites.find(i => i.proformaInvoice) ??
      reqInvites.find(i => i.status === 'approved') ??
      reqInvites[0]
    const vid = pick?.vendorId ?? target.request.finalVendorId
    return vid ? vendors.find(v => v.id === vid) : undefined
  }, [target, vendors, invites])

  const lineItems = useMemo(() => {
    if (!request) return []
    const all = request.lineItems ?? []
    if (invite?.awardedItemIds?.length) return all.filter(li => invite.awardedItemIds!.includes(li.id))
    return all
  }, [request, invite])

  const faCodes = (invite ? invite.faCodes : request?.faCodes) ?? {}
  const amount =
    invite?.awardAmount ??
    request?.purchaseOrder?.amount ??
    request?.budget ??
    0
  const status = invite ? invite.awardStatus ?? '' : request?.status ?? ''
  const existingPo = invite ? invite.purchaseOrder : request?.purchaseOrder
  const trialRequired = !!(invite ? invite.trialRequired : request?.trialRequired)

  const plantLabel = PLANTS.find(p => p.value === request?.plant)?.label ?? request?.plant ?? '—'

  const [poNumber, setPoNumber] = useState('')
  const [poAmount, setPoAmount] = useState('')
  const [poDocs, setPoDocs] = useState<PoDocDraft[]>([])
  const [poDocError, setPoDocError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const prefilled = useRef(false)

  useEffect(() => {
    if (!request || prefilled.current) return
    prefilled.current = true
    const suffix = invite
      ? `-${vendor?.vendorCode ?? vendor?.vendorName?.slice(0, 4) ?? 'AW'}`
      : ''
    setPoNumber(`PO-${request.requestNo ?? request.id.slice(0, 6)}${suffix}`)
    setPoAmount(String(amount || ''))
  }, [request, invite, vendor, amount])

  function handlePoDocFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    if (poDocs.length + files.length > MAX_PO_DOCS) {
      setPoDocError(`You can attach at most ${MAX_PO_DOCS} PO documents.`)
      e.target.value = ''
      return
    }
    const tooBig = files.find(f => f.size > MAX_PO_DOC_BYTES)
    if (tooBig) {
      setPoDocError(`"${tooBig.name}" is over 500 KB — each file must be under 500 KB.`)
      e.target.value = ''
      return
    }
    setPoDocError('')
    files.forEach(file => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        setPoDocs(prev => [
          ...prev,
          {
            id: `podoc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            base64: result.split(',')[1] ?? '',
            name: file.name,
            mimeType: file.type || 'application/octet-stream',
          },
        ])
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  function issuePo() {
    if (!request) return
    const amt = parseFloat(poAmount)
    if (!poNumber.trim()) return
    if (isNaN(amt) || amt <= 0) return
    if (poDocs.length === 0) {
      setPoDocError('Upload at least one PO document')
      return
    }
    const now = new Date().toISOString()
    const first = poDocs[0]
    const newPo: PurchaseOrder = {
      id: `po-${Date.now()}`,
      poNumber: poNumber.trim(),
      vendorId: vendor?.id ?? request.finalVendorId ?? '',
      amount: amt,
      createdAt: now,
      createdBy: 'Global Accounts (Sandeep)',
      poDocumentBase64: first.base64,
      poDocumentName: first.name,
      poDocumentMimeType: first.mimeType,
      poDocumentUploadedAt: now,
      poDocuments: poDocs.map(d => ({
        id: d.id,
        base64: d.base64,
        name: d.name,
        mimeType: d.mimeType,
        uploadedAt: now,
      })),
    }
    const ms = buildMilestonesFromVendor(vendor, amt)
    issuePurchaseOrder(request.id, newPo, ms, 'Global Accounts (Sandeep)', invite?.id)
    setTrialOnRequest(trialRequired)
    setDone(true)
  }

  if (!loaded) {
    return (
      <Shell>
        <Terminal icon={<Clock className="w-10 h-10 text-muted-foreground" />} title="Loading…" note="Fetching the PO handoff details." />
      </Shell>
    )
  }

  if (!target || !request) {
    return (
      <Shell>
        <Terminal
          icon={<XCircle className="w-10 h-10 text-red-500" />}
          title="Link Invalid or Expired"
          note="This PO link could not be matched to a live request. Please check with Plant Accounts."
        />
      </Shell>
    )
  }

  if (done || existingPo?.issuedAt || status === 'payment_in_progress' || status === 'completed') {
    const poNo = existingPo?.poNumber ?? poNumber
    return (
      <Shell>
        <div className={SUPPLIER_CARD}>
          <div className="flex flex-col items-center text-center gap-3 py-2">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
            <h1 className="text-lg font-bold text-foreground">PO Issued{poNo ? ` · ${poNo}` : ''}</h1>
            <p className="text-sm text-muted-foreground max-w-md">
              The vendor can now download the PO and re-upload their Proforma Invoice against it.
              Accounts then records milestone payments
              {(done ? trialOnRequest : trialRequired)
                ? '; after the advance is paid the vendor uploads the item trial, and the final payment waits for sourcing approval.'
                : '.'}
            </p>
          </div>
          <ol className="mt-4 text-sm text-muted-foreground space-y-2 list-decimal list-inside border-t border-border pt-4">
            <li className="font-semibold text-emerald-700">PO issued to vendor</li>
            <li>Vendor re-uploads PI against the PO</li>
            <li>Accounts team ticks payment milestones</li>
            {(done ? trialOnRequest : trialRequired) && (
              <li>Trial upload (after advance) → sourcing approve → final payment unlocks</li>
            )}
          </ol>
        </div>
      </Shell>
    )
  }

  if (status !== 'accounts_processing') {
    return (
      <Shell>
        <Terminal
          icon={<Clock className="w-10 h-10 text-muted-foreground" />}
          title="Not Ready for PO Yet"
          note={`This request is currently "${STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status}". Plant Accounts must submit FA codes before you can issue the PO.`}
        />
      </Shell>
    )
  }

  return (
    <Shell>
      <div className={`${SUPPLIER_CARD} space-y-4`}>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FileText className="w-4 h-4 text-blue-700" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Issue Purchase Order
            </span>
          </div>
          <h1 className="text-xl font-bold text-foreground">{request.subject || 'Capex Request'}</h1>
          <p className="text-sm text-muted-foreground">{request.requestNo}</p>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div>
            <span className="text-muted-foreground">Field: </span>
            <span className="font-semibold">{FIELD_TYPE_LABELS[request.fieldType ?? 'brown_field']}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Plant: </span>
            <span className="font-semibold">{plantLabel}</span>
          </div>
          <div className="flex items-center gap-1.5 col-span-2">
            <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Vendor: </span>
            <span className="font-semibold">{vendor?.vendorName ?? '—'}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Order value: </span>
            <span className="font-semibold">{fmt(amount)}</span>
          </div>
        </div>

        {lineItems.length > 0 && (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
              <Hash className="w-3.5 h-3.5" /> Ordered items & FA codes
            </p>
            <ul className="space-y-1.5">
              {lineItems.map((li, i) => (
                <li
                  key={li.id}
                  className="flex items-start justify-between gap-3 text-sm border border-border rounded-lg px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="text-muted-foreground mr-1">{i + 1}.</span>
                    {li.description}
                    <span className="text-muted-foreground"> · Qty {li.quantity}</span>
                  </span>
                  <span className="font-mono text-xs font-semibold shrink-0">{faCodes[li.id] ?? '—'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="border-t border-border pt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="po-number" className="block text-[11px] text-muted-foreground mb-1">
                PO Number
              </label>
              <input
                id="po-number"
                value={poNumber}
                onChange={e => setPoNumber(e.target.value)}
                className="w-48 text-sm border border-border rounded-lg px-2.5 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary min-h-[44px]"
              />
            </div>
            <div>
              <label htmlFor="po-amount" className="block text-[11px] text-muted-foreground mb-1">
                Amount (₹)
              </label>
              <input
                id="po-amount"
                type="number"
                value={poAmount}
                onChange={e => setPoAmount(e.target.value)}
                className="w-40 text-sm border border-border rounded-lg px-2.5 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary min-h-[44px]"
              />
            </div>
          </div>

          <div>
            <label htmlFor="po-doc" className="block text-[11px] text-muted-foreground mb-1">
              PO Documents{' '}
              <span className="text-muted-foreground/70">(PDF / image / Office · max 500 KB each)</span>
            </label>
            <input
              ref={fileInputRef}
              id="po-doc"
              type="file"
              multiple
              accept={PO_DOC_ACCEPT}
              onChange={handlePoDocFiles}
              className="sr-only"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border border-border rounded-lg bg-card hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-primary min-h-[44px]"
              >
                <Upload className="w-3.5 h-3.5" /> Add file{poDocs.length ? 's' : ''}
              </button>
              <span className="text-xs text-muted-foreground">
                {poDocs.length
                  ? `${poDocs.length} file${poDocs.length !== 1 ? 's' : ''} selected`
                  : 'No files selected'}
              </span>
            </div>
            {poDocs.length > 0 && (
              <ul className="mt-2 space-y-1">
                {poDocs.map(d => (
                  <li
                    key={d.id}
                    className="flex items-center gap-2 text-xs text-foreground bg-muted/20 border border-border rounded-lg px-2.5 py-1.5"
                  >
                    <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate flex-1">{d.name}</span>
                    <button
                      type="button"
                      onClick={() => setPoDocs(prev => prev.filter(x => x.id !== d.id))}
                      className="text-red-600 hover:underline shrink-0"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {poDocError && (
              <p className="mt-1 text-xs text-red-600" role="alert">
                {poDocError}
              </p>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground">
            Next: vendor re-uploads PI → Accounts pays milestones
            {trialRequired ? ' → trial after advance (final payment gated)' : ''}.
          </p>

          <button
            type="button"
            onClick={issuePo}
            disabled={!poNumber.trim() || !poAmount || poDocs.length === 0}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-semibold py-2.5 min-h-[44px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          >
            <Send className="w-4 h-4" /> Issue PO to vendor
          </button>
        </div>
      </div>
    </Shell>
  )
}
