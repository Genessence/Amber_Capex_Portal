'use client'

import { EmailPreviewModal } from './EmailPreviewModal'

/**
 * FA-code notification email preview. Thin wrapper around the shared {@link EmailPreviewModal} kept
 * for back-compat with existing call sites (AccountsPanel).
 */
export function FaEmailModal({
  open,
  onClose,
  defaultTo,
  subject,
  body,
  onSend,
}: {
  open: boolean
  onClose: () => void
  defaultTo: string
  subject: string
  body: string
  onSend: (to: string) => void
}) {
  return (
    <EmailPreviewModal
      open={open}
      onClose={onClose}
      title="FA Codes — Email Preview"
      defaultTo={defaultTo}
      subject={subject}
      body={body}
      onSend={onSend}
    />
  )
}
