import { describe, expect, it } from 'vitest';
import type { ApprovalRemark } from './types';
import {
  APPROVAL_ACTION_LABELS,
  APPROVAL_STAGE_LABELS,
  MAX_REMARKS_PER_ENTITY,
  MAX_REMARK_LENGTH,
  appendRemark,
  buildApprovalRemark,
  describeRemark,
  latestRemark,
  remarkPatch,
  remarkPatchFrom,
  remarksForStage,
  sanitizeRemarkText,
} from './approvalRemarks';

const AT = '2026-09-02T10:00:00.000Z';

const remark = (over: Partial<ApprovalRemark> = {}): ApprovalRemark => ({
  id: 'r1',
  stage: 'plant_head_request',
  action: 'approved',
  by: 'Plant Head (email)',
  text: 'Looks good',
  at: AT,
  ...over,
});

describe('sanitizeRemarkText', () => {
  it('trims and returns undefined for whitespace-only or non-string input', () => {
    expect(sanitizeRemarkText('  hello  ')).toBe('hello');
    expect(sanitizeRemarkText('   ')).toBeUndefined();
    expect(sanitizeRemarkText('')).toBeUndefined();
    expect(sanitizeRemarkText(undefined)).toBeUndefined();
    expect(sanitizeRemarkText(null)).toBeUndefined();
    expect(sanitizeRemarkText(42)).toBeUndefined();
    expect(sanitizeRemarkText({ text: 'x' })).toBeUndefined();
  });

  it('strips control characters but keeps newlines and tabs', () => {
    expect(sanitizeRemarkText('a\u0000b\u0007c')).toBe('abc');
    expect(sanitizeRemarkText('line1\nline2\tend')).toBe('line1\nline2\tend');
  });

  it('normalises CRLF and collapses runs of blank lines', () => {
    expect(sanitizeRemarkText('a\r\nb')).toBe('a\nb');
    expect(sanitizeRemarkText('a\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('a remark made of nothing but control characters is not a remark', () => {
    expect(sanitizeRemarkText('\u0000\u0001\u0002')).toBeUndefined();
  });

  it('truncates at the cap with an ellipsis rather than dropping the remark', () => {
    const long = 'x'.repeat(MAX_REMARK_LENGTH + 500);
    const out = sanitizeRemarkText(long)!;
    expect(out).toHaveLength(MAX_REMARK_LENGTH);
    expect(out.endsWith('…')).toBe(true);
  });

  it('leaves a remark exactly at the cap untouched', () => {
    const exact = 'y'.repeat(MAX_REMARK_LENGTH);
    expect(sanitizeRemarkText(exact)).toBe(exact);
  });
});

describe('buildApprovalRemark', () => {
  it('returns null when nothing was typed — an empty remark is not recorded', () => {
    expect(buildApprovalRemark({ stage: 'admin_budget', action: 'approved', by: 'Admin', text: '' })).toBeNull();
    expect(buildApprovalRemark({ stage: 'admin_budget', action: 'approved', by: 'Admin', text: '   ' })).toBeNull();
    expect(buildApprovalRemark({ stage: 'admin_budget', action: 'approved', by: 'Admin', text: undefined })).toBeNull();
  });

  it('builds a sanitized remark with the injected id and timestamp', () => {
    const r = buildApprovalRemark({
      stage: 'technical_spec',
      action: 'sent_back',
      by: '  Technical Team  ',
      text: '  Motor rating too low  ',
      at: AT,
      id: 'fixed-id',
    });
    expect(r).toEqual({
      id: 'fixed-id',
      stage: 'technical_spec',
      action: 'sent_back',
      by: 'Technical Team',
      text: 'Motor rating too low',
      at: AT,
    });
  });

  it('falls back to "Unknown" rather than an empty author', () => {
    expect(buildApprovalRemark({ stage: 'admin_budget', action: 'noted', by: '  ', text: 'hi' })?.by).toBe('Unknown');
  });
});

describe('appendRemark / remarkPatch', () => {
  it('returns the trail unchanged — same reference — for a null remark', () => {
    const trail = [remark()];
    expect(appendRemark(trail, null)).toBe(trail);
    expect(appendRemark(undefined, null)).toBeUndefined();
  });

  it('appends oldest-first onto an absent trail', () => {
    const r = remark();
    expect(appendRemark(undefined, r)).toEqual([r]);
  });

  it('caps the trail, dropping the OLDEST entries', () => {
    const trail = Array.from({ length: MAX_REMARKS_PER_ENTITY }, (_, i) => remark({ id: `r${i}` }));
    const next = appendRemark(trail, remark({ id: 'newest' }))!;
    expect(next).toHaveLength(MAX_REMARKS_PER_ENTITY);
    expect(next[next.length - 1].id).toBe('newest');
    expect(next[0].id).toBe('r1'); // r0 fell off the front
  });

  it('remarkPatch is an EMPTY object for a null remark, so the field is left alone', () => {
    expect(remarkPatch([remark()], null)).toEqual({});
    const patched = remarkPatch([remark()], remark({ id: 'r2' }));
    expect(patched.approvalRemarks).toHaveLength(2);
  });

  it('remarkPatchFrom short-circuits on empty text', () => {
    expect(remarkPatchFrom([remark()], { stage: 'admin_budget', action: 'approved', by: 'Admin', text: '  ' })).toEqual({});
    const patched = remarkPatchFrom(undefined, {
      stage: 'accounts_budget',
      action: 'approved',
      by: 'Satish',
      text: 'Funded from reserve',
      at: AT,
    });
    expect(patched.approvalRemarks?.[0].text).toBe('Funded from reserve');
  });
});

describe('reading the trail', () => {
  const trail = [
    remark({ id: 'a', stage: 'plant_head_budget', at: '2026-09-01T00:00:00.000Z' }),
    remark({ id: 'b', stage: 'admin_budget', at: '2026-09-02T00:00:00.000Z' }),
    remark({ id: 'c', stage: 'admin_budget', at: '2026-09-03T00:00:00.000Z' }),
  ];

  it('filters by one stage or a set of stages', () => {
    expect(remarksForStage(trail, 'admin_budget').map(r => r.id)).toEqual(['b', 'c']);
    expect(remarksForStage(trail, ['plant_head_budget', 'admin_budget']).map(r => r.id)).toEqual(['a', 'b', 'c']);
    expect(remarksForStage(undefined, 'admin_budget')).toEqual([]);
  });

  it('latestRemark reads the end of the trail, optionally within a stage', () => {
    expect(latestRemark(trail)?.id).toBe('c');
    expect(latestRemark(trail, 'plant_head_budget')?.id).toBe('a');
    expect(latestRemark(trail, 'technical_spec')).toBeUndefined();
    expect(latestRemark([])).toBeUndefined();
    expect(latestRemark(undefined)).toBeUndefined();
  });
});

describe('labels', () => {
  it('every stage and action a remark can carry has a label — a missing one renders a raw key', () => {
    const stages = Object.keys(APPROVAL_STAGE_LABELS);
    const actions = Object.keys(APPROVAL_ACTION_LABELS);
    expect(stages.length).toBeGreaterThan(0);
    expect(actions.length).toBeGreaterThan(0);
    for (const label of [...Object.values(APPROVAL_STAGE_LABELS), ...Object.values(APPROVAL_ACTION_LABELS)]) {
      expect(label.trim()).not.toBe('');
    }
  });

  it('describeRemark reads as one line for an email body', () => {
    expect(describeRemark(remark({ text: 'Approved with conditions' }))).toBe(
      'Plant Head — Approved by Plant Head (email): Approved with conditions',
    );
  });
});
