"use client"

import { useState } from "react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { useCapex } from "@/lib/capexContext"
import { generateToken } from "@/lib/tokenUtils"
import type { PaymentSplit, Vendor, VendorInvite } from "@/lib/types"

const CATEGORIES = ["Machinery", "Infrastructure", "IT", "Tooling"]
const PAYMENT_TERMS = ["Net-30", "Net-60", "Advance"] as const

interface Props {
  open: boolean
  onClose: () => void
  requestId: string
  defaultTab?: "existing" | "onboard"
}

function genId() {
  return `v-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function VendorOnboardModal({ open, onClose, requestId, defaultTab = "existing" }: Props) {
  const { vendors, invites, addVendor, addInvite } = useCapex()

  const [search, setSearch] = useState("")

  // New vendor form state
  const [vendorCode,   setVendorCode]   = useState("")
  const [vendorName,   setVendorName]   = useState("")
  const [category,     setCategory]     = useState("")
  const [gstin,        setGstin]        = useState("")
  const [pan,          setPan]          = useState("")
  const [contactName,  setContactName]  = useState("")
  const [contactEmail, setContactEmail] = useState("")
  const [paymentTerms, setPaymentTerms] = useState("")
  const [bankName,     setBankName]     = useState("")
  const [accountNumber,setAccountNumber]= useState("")
  const [ifsc,         setIfsc]         = useState("")
  const [oneTime,      setOneTime]      = useState(false)
  const [paymentTermsText, setPaymentTermsText] = useState("")
  const [advancePct,   setAdvancePct]   = useState("30")
  const [dispatchPct,  setDispatchPct]  = useState("60")
  const [installPct,   setInstallPct]   = useState("10")

  const alreadyInvitedIds = new Set(
    invites.filter(i => i.requestId === requestId).map(i => i.vendorId)
  )
  const availableVendors = vendors.filter(v =>
    !alreadyInvitedIds.has(v.id) &&
    (v.vendorName.toLowerCase().includes(search.toLowerCase()) ||
     v.vendorCode.toLowerCase().includes(search.toLowerCase()) ||
     v.category.toLowerCase().includes(search.toLowerCase()))
  )

  const inviteVendor = (vendorId: string) => {
    const invite: VendorInvite = {
      id: `inv-${Date.now()}`,
      requestId,
      vendorId,
      token: generateToken(vendorId, requestId),
      status: "invited",
      auctionApprovalStatus: "not_sent",
      quotes: [],
      negotiationThread: [],
      invitedAt: new Date().toISOString(),
    }
    addInvite(invite)
    onClose()
  }

  const newVendorValid = vendorCode && vendorName && category && contactEmail

  const handleOnboardSubmit = () => {
    if (!newVendorValid) return
    const vendor: Vendor = {
      id: genId(),
      vendorCode,
      vendorName,
      category,
      gstin,
      pan,
      contactName,
      contactEmail,
      paymentTerms: (paymentTerms as Vendor["paymentTerms"]) || "Net-30",
      bankName,
      accountNumber,
      ifsc,
      onboardedAt: new Date().toISOString(),
      oneTime,
      paymentTermsText: paymentTermsText.trim() || undefined,
      paymentSplits: ([
        { id: "adv", label: "Advance", percent: Number(advancePct) || 0, trigger: "On PO" },
        { id: "dispatch", label: "On Dispatch", percent: Number(dispatchPct) || 0, trigger: "On dispatch" },
        { id: "install", label: "On Installation", percent: Number(installPct) || 0, trigger: "On installation" },
      ] as PaymentSplit[]).filter(s => s.percent > 0),
    }
    addVendor(vendor)
    if (requestId) {
      const invite: VendorInvite = {
        id: `inv-${Date.now()}`,
        requestId,
        vendorId: vendor.id,
        token: generateToken(vendor.id, requestId),
        status: "invited",
        auctionApprovalStatus: "not_sent",
        quotes: [],
        negotiationThread: [],
        invitedAt: new Date().toISOString(),
      }
      addInvite(invite)
    }
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Vendor to Request</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue={defaultTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="existing">Existing Vendors</TabsTrigger>
            <TabsTrigger value="onboard">Onboard New</TabsTrigger>
          </TabsList>

          {/* Existing Vendors */}
          <TabsContent value="existing">
            <div className="space-y-3">
              <Input
                placeholder="Search vendors…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-white"
              />
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {availableVendors.length === 0 && (
                  <p className="text-sm text-slate-400 text-center py-8">No vendors available to invite.</p>
                )}
                {availableVendors.map(v => (
                  <div key={v.id} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{v.vendorName}</p>
                      <p className="text-xs text-slate-400">{v.vendorCode} · {v.category}</p>
                    </div>
                    <Button size="sm" onClick={() => inviteVendor(v.id)}
                      className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold">
                      Invite
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>

          {/* Onboard New */}
          <TabsContent value="onboard">
            <div className="grid grid-cols-2 gap-4 max-h-[420px] overflow-y-auto pr-1">
              <Field label="Vendor Code *">
                <Input value={vendorCode} onChange={e => setVendorCode(e.target.value)} placeholder="VND-XXX" />
              </Field>
              <Field label="Vendor Name *">
                <Input value={vendorName} onChange={e => setVendorName(e.target.value)} placeholder="Company name" />
              </Field>
              <Field label="Category *">
                <Select value={category} onValueChange={v => { if (v) setCategory(v) }}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="GSTIN">
                <Input value={gstin} onChange={e => setGstin(e.target.value)} placeholder="27AABCT3518Q1ZK" />
              </Field>
              <Field label="PAN">
                <Input value={pan} onChange={e => setPan(e.target.value)} placeholder="AABCT3518Q" />
              </Field>
              <Field label="Contact Name">
                <Input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Full name" />
              </Field>
              <Field label="Contact Email *">
                <Input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="contact@vendor.com" />
              </Field>
              <Field label="Payment Terms">
                <Select value={paymentTerms} onValueChange={v => { if (v) setPaymentTerms(v) }}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Select terms" /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_TERMS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Bank Name">
                <Input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="HDFC Bank" />
              </Field>
              <Field label="Account Number">
                <Input value={accountNumber} onChange={e => setAccountNumber(e.target.value)} placeholder="Account number" />
              </Field>
              <Field label="IFSC">
                <Input value={ifsc} onChange={e => setIfsc(e.target.value)} placeholder="HDFC0001234" />
              </Field>

              <div className="col-span-2 flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                <Checkbox id="oneTime" checked={oneTime} onCheckedChange={v => setOneTime(!!v)} className="mt-0.5" />
                <label htmlFor="oneTime" className="text-xs text-slate-900 leading-snug cursor-pointer">
                  <span className="font-semibold">One-time / not-yet-onboarded vendor</span> — payment terms are not fetched
                  from the onboarding portal, so they will be sent with the approval documents for the vendor to accept.
                </label>
              </div>

              {oneTime && (
                <Field label="Payment Terms Note (sent to vendor)">
                  <Input value={paymentTermsText} onChange={e => setPaymentTermsText(e.target.value)} placeholder="e.g. 30% advance, 60% on dispatch, 10% on installation" />
                </Field>
              )}

              <div className="col-span-2">
                <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Payment Terms Split (%)</Label>
                <div className="grid grid-cols-3 gap-3 mt-1.5">
                  <div>
                    <p className="text-[11px] text-slate-400 mb-1">Advance</p>
                    <Input type="number" value={advancePct} onChange={e => setAdvancePct(e.target.value)} />
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-400 mb-1">On Dispatch</p>
                    <Input type="number" value={dispatchPct} onChange={e => setDispatchPct(e.target.value)} />
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-400 mb-1">On Installation</p>
                    <Input type="number" value={installPct} onChange={e => setInstallPct(e.target.value)} />
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Used to build payment milestones when this vendor is finalized. Total: {(Number(advancePct) || 0) + (Number(dispatchPct) || 0) + (Number(installPct) || 0)}%
                </p>
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                onClick={handleOnboardSubmit}
                disabled={!newVendorValid}
                className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-semibold"
              >
                Onboard & Invite
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{label}</Label>
      {children}
    </div>
  )
}
