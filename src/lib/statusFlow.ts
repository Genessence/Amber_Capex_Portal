/**
 * Request status flow — the single source of truth for which `CapexStatus` transitions are legal.
 *
 * Lives in its own module (rather than inside `capexContext`) so UI call sites can ASK before they
 * act instead of firing a mutation that `updateRequest` silently refuses. A button that reports
 * success for a transition the state machine rejected is worse than a disabled button: the user
 * walks away believing a request was rejected/approved when it is still live.
 */
import type { CapexStatus } from './types';

export const ALLOWED_TRANSITIONS: Record<CapexStatus, CapexStatus[]> = {
  draft:                  ['submitted'],
  submitted:              ['pending_head_approval', 'sourcing'],
  pending_head_approval:  ['sourcing', 'rejected'],
  // RFQ + auction converge into the fulfillment chain directly from sourcing
  // (auction now mirrors RFQ: finalize winner → request PI, no buyer-approval detour).
  // `rejected` is reachable here from the comparison grid's Reject control — it was missing, so
  // the button silently no-op'd while toasting "Request rejected".
  sourcing:               ['negotiation', 'sourcing_approved', 'pi_requested', 'rejected'],
  // pi_requested targets below cover legacy/in-flight auction requests parked at
  // negotiation / sourcing_approved / buyer_approved before the buyer step was dropped
  negotiation:            ['sourcing_approved', 'pi_requested', 'rejected'],
  sourcing_approved:      ['buyer_approved', 'pi_requested', 'rejected'],
  // `rejected` added for the same reason as `sourcing`: the grid's Reject control is reachable at
  // this legacy state too, and every sibling pre-fulfillment status already allows it.
  buyer_approved:         ['pi_requested', 'rejected'],
  // Shared Brown Field fulfillment chain: PI → accounts/PO → payments → completed.
  // `pi_requested → completed` covers award-based (split-auction) requests, whose granular
  // fulfillment is tracked per-award on the invites while the request status stays coarse
  // (pi_requested) until every award completes.
  pi_requested:           ['pi_submitted', 'completed', 'rejected'],
  pi_submitted:           ['accounts_processing', 'rejected'],
  accounts_processing:    ['payment_in_progress', 'rejected'],
  // NOTE: `payment_in_progress` deliberately has no `rejected` edge — money has already moved, so
  // cancelling a part-paid order is a governance decision, not a status hop. `completed` and
  // `rejected` are terminal. Call sites must check `canTransitionStatus` rather than assume.
  payment_in_progress:    ['completed'],
  completed:              [],
  rejected:               [],
};

/**
 * Pre-PI states a request can sit in when its award is finalized. `sourcing` is the normal one;
 * the rest are legacy/in-flight states an escalated RFQ can be parked at (the old buyer-approval
 * detour). Awarding from any of them must carry the request into `pi_requested` — every entry has
 * that target in `ALLOWED_TRANSITIONS`.
 */
export const PRE_PI_REQUEST_STATUSES: CapexStatus[] = [
  'sourcing',
  'negotiation',
  'sourcing_approved',
  'buyer_approved',
];

/**
 * Whether `updateRequest` would accept moving a request from `from` to `to`.
 *
 * A no-op (`from === to`) counts as allowed, mirroring `updateRequest`, which only validates when
 * the status actually changes.
 */
export function canTransitionStatus(from: CapexStatus, to: CapexStatus): boolean {
  if (from === to) return true;
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}
