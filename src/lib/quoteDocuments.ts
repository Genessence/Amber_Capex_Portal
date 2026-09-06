/**
 * Per-LINE-ITEM quotation documents — the vendor attaches one supporting file (datasheet, drawing,
 * compliance certificate) to each line they price, instead of one undifferentiated attachment for
 * the whole quote. Sourcing and the Technical team then read the paperwork against the exact line
 * it describes.
 *
 * Pure module (no React, no DOM types beyond `File`/`FileReader`, both of which are only touched
 * inside `readQuoteLineDocument`, which the caller may skip). Unit-tested in `quoteDocuments.test.ts`.
 *
 * STORAGE: `QuoteLineDocument.base64` is a blob and therefore lives in IndexedDB under `qdoc:<id>`,
 * exactly like PIs, PO documents and tech-spec sheets — `stripInviteFiles`/`hydrateInviteFiles` in
 * `capexContext.tsx` move it in and out. Nothing here may assume `base64` is populated: on a freshly
 * loaded page the metadata arrives first and the payload is merged back in asynchronously, so every
 * render path must tolerate an empty `base64` (the UI disables the download rather than offering a
 * broken `data:` URL).
 */
import type { CapexLineItem, QuoteLineDocument } from './types';

/**
 * Per-file cap, matching the supplier portal's existing attachment limit (`MAX_FILE_BYTES` on the
 * supplier page). Base64 inflates a payload by ~4/3, so 500 KB of file is ~683 KB stored — with one
 * document per line and IndexedDB (not localStorage) carrying it, that is the right order of
 * magnitude for a datasheet while still refusing a 20 MB scan.
 */
export const MAX_LINE_DOC_BYTES = 500 * 1024;

/** Accepted upload types — the same set the PO-document uploader accepts. */
export const LINE_DOC_ACCEPT =
  '.pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.csv,application/pdf,image/*';

export const LINE_DOC_SIZE_ERROR = 'File must be under 500 KB';

/** Human-readable size for the UI ("412 KB", "1.2 MB"). Returns `''` when the size is unknown. */
export function formatDocSize(bytes?: number): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Read a picked `File` into a `QuoteLineDocument`. Rejects (resolves to an `error`) rather than
 * throwing, so the caller renders a message next to the input instead of blowing up the page.
 */
export function readQuoteLineDocument(
  file: File,
  uploadedBy?: string,
): Promise<{ doc: QuoteLineDocument; error?: undefined } | { doc?: undefined; error: string }> {
  return new Promise((resolve) => {
    if (file.size > MAX_LINE_DOC_BYTES) {
      resolve({ error: LINE_DOC_SIZE_ERROR });
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => resolve({ error: 'Could not read that file — please try again' });
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.split(',')[1] ?? '';
      if (!base64) {
        resolve({ error: 'Could not read that file — please try again' });
        return;
      }
      resolve({
        doc: {
          id: `qdoc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          base64,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          uploadedAt: new Date().toISOString(),
          uploadedBy,
        },
      });
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Sanitize an untrusted `lineDocuments` map at the mutation boundary (the supplier portal is a
 * public, tokenised page). Keeps only well-formed entries, drops anything keyed to a line item the
 * request does not have, and caps the map at one document per line.
 *
 * `allowedItemIds` is optional because a legacy lump-sum quote has no line items; when it is
 * omitted, the keys are kept as given (the shape check still applies).
 */
export function sanitizeLineDocuments(
  raw: unknown,
  allowedItemIds?: string[],
): Record<string, QuoteLineDocument> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const allowed = allowedItemIds ? new Set(allowedItemIds) : null;
  const out: Record<string, QuoteLineDocument> = {};
  for (const [itemId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (allowed && !allowed.has(itemId)) continue;
    const d = value as Partial<QuoteLineDocument> | null;
    if (!d || typeof d !== 'object') continue;
    if (typeof d.name !== 'string' || !d.name.trim()) continue;
    // `base64` may legitimately be '' — the blob lives in IndexedDB and is merged back in on load,
    // so a stripped-but-real document must survive a re-sanitize (e.g. sourcing countering a quote).
    if (typeof d.base64 !== 'string') continue;
    out[itemId] = {
      id: typeof d.id === 'string' && d.id ? d.id : `qdoc-${itemId}`,
      name: d.name.trim().slice(0, 200),
      base64: d.base64,
      mimeType: typeof d.mimeType === 'string' ? d.mimeType : undefined,
      size: typeof d.size === 'number' && Number.isFinite(d.size) && d.size >= 0 ? d.size : undefined,
      uploadedAt: typeof d.uploadedAt === 'string' && d.uploadedAt ? d.uploadedAt : new Date().toISOString(),
      uploadedBy: typeof d.uploadedBy === 'string' ? d.uploadedBy.slice(0, 120) : undefined,
    };
  }
  return Object.keys(out).length ? out : undefined;
}

/** How many of a request's line items carry a document on this quote. */
export function lineDocumentCount(
  docs: Record<string, QuoteLineDocument> | undefined,
  lineItems?: CapexLineItem[],
): number {
  if (!docs) return 0;
  if (!lineItems?.length) return Object.keys(docs).length;
  return lineItems.filter((li) => !!docs[li.id]).length;
}

/**
 * A `data:` URL for downloading a document, or `undefined` when the blob is not hydrated yet.
 * Callers MUST treat `undefined` as "not downloadable" rather than falling back to an empty href —
 * an anchor with no href that still looks like a link is the failure mode this exists to prevent.
 */
export function lineDocumentHref(doc?: QuoteLineDocument): string | undefined {
  if (!doc?.base64) return undefined;
  return `data:${doc.mimeType || 'application/octet-stream'};base64,${doc.base64}`;
}
