import { describe, expect, it } from 'vitest';
import type { CapexLineItem, QuoteLineDocument } from './types';
import {
  formatDocSize,
  lineDocumentCount,
  lineDocumentHref,
  sanitizeLineDocuments,
} from './quoteDocuments';

const doc = (over: Partial<QuoteLineDocument> = {}): QuoteLineDocument => ({
  id: 'qdoc-1',
  name: 'datasheet.pdf',
  base64: 'AAAA',
  mimeType: 'application/pdf',
  size: 2048,
  uploadedAt: '2026-09-02T10:00:00.000Z',
  ...over,
});

const line = (id: string): CapexLineItem => ({
  id,
  description: `Item ${id}`,
  category: 'Machinery',
  quantity: '1',
});

describe('sanitizeLineDocuments', () => {
  it('rejects non-object input outright', () => {
    expect(sanitizeLineDocuments(undefined)).toBeUndefined();
    expect(sanitizeLineDocuments(null)).toBeUndefined();
    expect(sanitizeLineDocuments('nope')).toBeUndefined();
    expect(sanitizeLineDocuments([doc()])).toBeUndefined();
  });

  it('keeps well-formed entries and normalises the fields', () => {
    const out = sanitizeLineDocuments({ 'li-1': doc({ name: '  spec.pdf  ' }) })!;
    expect(out['li-1'].name).toBe('spec.pdf');
    expect(out['li-1'].base64).toBe('AAAA');
    expect(out['li-1'].size).toBe(2048);
  });

  it('DROPS keys that are not line items on this request — the supplier page is public', () => {
    const raw = { 'li-1': doc(), 'li-evil': doc({ id: 'qdoc-2' }) };
    const out = sanitizeLineDocuments(raw, ['li-1'])!;
    expect(Object.keys(out)).toEqual(['li-1']);
  });

  it('keeps every key when no allow-list is given (legacy lump-sum quote)', () => {
    const out = sanitizeLineDocuments({ a: doc(), b: doc({ id: 'qdoc-2' }) })!;
    expect(Object.keys(out).sort()).toEqual(['a', 'b']);
  });

  it('drops malformed entries: missing/blank name, non-string base64, non-objects', () => {
    const raw = {
      ok: doc(),
      noName: { ...doc(), name: '' },
      blankName: { ...doc(), name: '   ' },
      badB64: { ...doc(), base64: 12345 },
      notAnObject: 'x',
      nullish: null,
    };
    const out = sanitizeLineDocuments(raw)!;
    expect(Object.keys(out)).toEqual(['ok']);
  });

  it('KEEPS an entry whose base64 is empty — the blob lives in IndexedDB and is merged back later', () => {
    // This is the case that matters most: state persisted to localStorage has the payload stripped,
    // so re-sanitizing a stored quote (e.g. when sourcing counters it) must not delete the document.
    const out = sanitizeLineDocuments({ 'li-1': doc({ base64: '' }) })!;
    expect(out['li-1'].base64).toBe('');
    expect(out['li-1'].name).toBe('datasheet.pdf');
  });

  it('drops a negative or non-finite size rather than storing it', () => {
    const out = sanitizeLineDocuments({
      a: doc({ size: -5 }),
      b: doc({ size: Number.NaN }),
      c: doc({ size: 10 }),
    })!;
    expect(out.a.size).toBeUndefined();
    expect(out.b.size).toBeUndefined();
    expect(out.c.size).toBe(10);
  });

  it('caps the stored name so one upload cannot bloat the payload', () => {
    const out = sanitizeLineDocuments({ a: doc({ name: 'n'.repeat(500) }) })!;
    expect(out.a.name).toHaveLength(200);
  });

  it('returns undefined when nothing survives, so an empty map is never stored', () => {
    expect(sanitizeLineDocuments({ bad: { name: '' } })).toBeUndefined();
    expect(sanitizeLineDocuments({}, [])).toBeUndefined();
  });
});

describe('lineDocumentHref', () => {
  it('builds a data URL only when the blob is hydrated', () => {
    expect(lineDocumentHref(doc())).toBe('data:application/pdf;base64,AAAA');
    expect(lineDocumentHref(doc({ base64: '' }))).toBeUndefined();
    expect(lineDocumentHref(undefined)).toBeUndefined();
  });

  it('falls back to a generic mime type rather than emitting "data:undefined;"', () => {
    expect(lineDocumentHref(doc({ mimeType: undefined }))).toBe('data:application/octet-stream;base64,AAAA');
  });
});

describe('lineDocumentCount', () => {
  it('counts only documents attached to the given line items', () => {
    const docs = { 'li-1': doc(), 'li-9': doc({ id: 'qdoc-2' }) };
    expect(lineDocumentCount(docs, [line('li-1'), line('li-2')])).toBe(1);
    expect(lineDocumentCount(docs)).toBe(2);
    expect(lineDocumentCount(undefined, [line('li-1')])).toBe(0);
  });
});

describe('formatDocSize', () => {
  it('renders bytes, KB and MB, and nothing for an unknown size', () => {
    expect(formatDocSize(512)).toBe('512 B');
    expect(formatDocSize(2048)).toBe('2 KB');
    expect(formatDocSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatDocSize(undefined)).toBe('');
    expect(formatDocSize(0)).toBe('');
    expect(formatDocSize(Number.NaN)).toBe('');
  });
});
