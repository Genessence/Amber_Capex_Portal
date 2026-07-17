/**
 * Trial (QA) status helpers. When sourcing marks a request/award as `trialRequired`, the vendor must
 * upload a trial asset (video/photo/report) after the advance payment; sourcing approves or rejects
 * (loop), and the final payment is blocked until the trial is approved.
 */
import type { TrialStatus } from './types';
import { BADGE_TONE } from './constants';

export const TRIAL_STATUS_LABELS: Record<TrialStatus, string> = {
  not_required: 'No Trial',
  pending_upload: 'Awaiting Trial Upload',
  pending_review: 'Trial Under Review',
  approved: 'Trial Approved',
  rejected: 'Trial Rejected',
};

export const TRIAL_STATUS_COLORS: Record<TrialStatus, string> = {
  not_required: BADGE_TONE.soft,
  pending_upload: BADGE_TONE.pending,
  pending_review: BADGE_TONE.active,
  approved: BADGE_TONE.done,
  rejected: BADGE_TONE.danger,
};

/** Resolve the effective trial status for a request or award (defaults when unset). */
export function effectiveTrialStatus(entity: { trialRequired?: boolean; trialStatus?: TrialStatus }): TrialStatus {
  if (!entity.trialRequired) return 'not_required';
  return entity.trialStatus ?? 'pending_upload';
}
