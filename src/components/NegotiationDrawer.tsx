"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp, Paperclip } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { VendorInvite, Vendor } from "@/lib/types"
import { INVITE_STATUS_COLORS, INVITE_STATUS_ICONS } from "@/lib/constants"

const SOURCING_ROLES = [
  "sourcing_member",
  "sourcing_member_2",
  "sourcing_member_3",
  "sourcing_member_4",
  "sourcing_head",
  "super_admin",
]

function formatTs(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  })
}

function formatPrice(n: number) {
  return "₹" + n.toLocaleString("en-IN")
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  })
}

interface Props {
  open: boolean
  onClose: () => void
  invite: VendorInvite
  vendor: Vendor
  currentRole: string
  onSendMessage: (message: string, counterPrice?: number) => void
}

export function NegotiationDrawer({ open, onClose, invite, vendor, currentRole, onSendMessage }: Props) {
  const [message,      setMessage]      = useState("")
  const [counterPrice, setCounterPrice] = useState("")
  const [historyOpen,  setHistoryOpen]  = useState(invite.quotes.length >= 2)

  const latestQuote = invite.quotes.length > 0 ? invite.quotes[invite.quotes.length - 1] : null
  const canSend = SOURCING_ROLES.includes(currentRole)

  const handleSend = () => {
    if (!message.trim()) return
    onSendMessage(message.trim(), counterPrice ? Number(counterPrice) : undefined)
    setMessage("")
    setCounterPrice("")
  }

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose() }}>
      <SheetContent className="sm:max-w-[520px]">

        <SheetHeader>
          <div className="flex items-center justify-between pr-8">
            <SheetTitle>{vendor.vendorName}</SheetTitle>
            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full ${INVITE_STATUS_COLORS[invite.status] ?? "bg-slate-100 text-slate-600"}`}>
              {(() => { const I = INVITE_STATUS_ICONS[invite.status]; return I ? <I className="w-3.5 h-3.5 shrink-0" strokeWidth={2.25} aria-hidden /> : null })()}
              {invite.status.replace("_", " ")}
            </span>
          </div>
          <p className="text-xs text-slate-400">{vendor.vendorCode} · {vendor.category}</p>
        </SheetHeader>

        {/* Quote summary strip — latest quote only */}
        {latestQuote && (
          <div className="mx-6 mt-4 grid grid-cols-3 gap-2">
            {[
              { label: "Latest Price",  value: formatPrice(latestQuote.price) },
              { label: "Delivery Days", value: `${latestQuote.deliveryDays}d` },
              { label: "Valid Until",   value: formatDate(latestQuote.validUntil) },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>
                <p className="text-sm font-semibold text-slate-800 mt-0.5">{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Quote history */}
        {invite.quotes.length > 0 && (
          <div className="mx-6 mt-3">
            <button
              type="button"
              onClick={() => setHistoryOpen(v => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors mb-1.5"
            >
              {historyOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              Quote History ({invite.quotes.length})
            </button>

            {historyOpen && (
              <div className="bg-slate-50 rounded-xl border border-slate-100 divide-y divide-slate-100">
                {invite.quotes.map((q, i) => (
                  <div key={q.id ?? i} className="px-4 py-2.5 flex items-center justify-between text-sm">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-400 font-medium w-5">#{i + 1}</span>
                      <span className="font-bold text-slate-800">{formatPrice(q.price)}</span>
                      <span className="text-slate-500">{q.deliveryDays}d</span>
                      <span className="text-slate-400 text-xs">until {formatDate(q.validUntil)}</span>
                    </div>
                    {q.attachmentName && (
                      <span className="flex items-center gap-1 text-xs text-slate-400 truncate max-w-[140px]">
                        <Paperclip size={11} className="shrink-0" />
                        {q.attachmentName}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Message thread */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 min-h-0">
          {invite.negotiationThread.length === 0 && (
            <p className="text-center text-sm text-slate-400 py-8">No messages yet.</p>
          )}
          {invite.negotiationThread.map(msg => {
            const isSourcing = msg.by === "sourcing"
            return (
              <div key={msg.id} className={`flex flex-col gap-1 ${isSourcing ? "items-end" : "items-start"}`}>
                <p className="text-[10px] text-slate-400 px-1">
                  {isSourcing ? "Sourcing" : vendor.vendorName} · {formatTs(msg.at)}
                </p>
                <div className={`max-w-[320px] rounded-2xl px-4 py-2.5 text-sm ${isSourcing ? "bg-slate-100 text-slate-800" : "bg-[#DBEAFE] text-slate-800"}`}>
                  {msg.counterPrice && (
                    <span className="inline-flex items-center gap-1 mb-1.5 text-[11px] font-bold text-[#1D4ED8] bg-[#DBEAFE] rounded-full px-2 py-0.5">
                      Counter: {formatPrice(msg.counterPrice)}
                    </span>
                  )}
                  <p>{msg.message}</p>
                </div>
              </div>
            )
          })}
        </div>

        {/* Send area */}
        {canSend && (
          <SheetFooter className="flex-col gap-2 items-stretch">
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Type a message…"
              rows={3}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/50 resize-none"
            />
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={counterPrice}
                onChange={e => setCounterPrice(e.target.value)}
                placeholder="Counter price (INR, optional)"
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/50"
              />
              <Button
                onClick={handleSend}
                disabled={!message.trim()}
                className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-semibold"
              >
                Send
              </Button>
            </div>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  )
}
