/**
 * Turn-Around-Time (TAT) + delay-liability computation.
 *
 * The TAT clock starts one week after the Proforma Invoice is submitted. Delay liability:
 *   • 0.5% of the order value per week of delay, up to a cumulative 5% (i.e. weeks 1–10)
 *   • thereafter the rate escalates to 5% of the order value per week
 * The clock stops when the final payment is made (`tatStoppedAt`).
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const GRACE_MS = WEEK_MS; // 1 week after PI

export interface TatResult {
  /** TAT applies (PI submitted). */
  applicable: boolean;
  /** Clock still running (not stopped by final payment). */
  running: boolean;
  /** When the grace period ends and delay deductions begin accruing. */
  graceEndsAt: number;
  /** Whole weeks of delay counted so far. */
  weeksLate: number;
  /** Cumulative deduction percentage of the order value. */
  deductionPct: number;
  /** Deduction amount in INR. */
  deductionAmount: number;
  /** True once the escalated 5%/week rate is in effect. */
  escalated: boolean;
  /** ms until the grace period ends (negative once delays accrue). */
  msToGrace: number;
}

export function computeTat(opts: {
  piSubmittedAt?: string;
  vendorAmount: number;
  tatStoppedAt?: string;
  now: number;
}): TatResult {
  const { piSubmittedAt, vendorAmount, tatStoppedAt, now } = opts;
  if (!piSubmittedAt) {
    return {
      applicable: false, running: false, graceEndsAt: 0, weeksLate: 0,
      deductionPct: 0, deductionAmount: 0, escalated: false, msToGrace: 0,
    };
  }

  const piMs = new Date(piSubmittedAt).getTime();
  const graceEndsAt = piMs + GRACE_MS;
  const stoppedMs = tatStoppedAt ? new Date(tatStoppedAt).getTime() : null;
  const running = stoppedMs == null;
  // Evaluate against the stop time if stopped, else against now.
  const evalAt = stoppedMs ?? now;

  let weeksLate = 0;
  if (evalAt > graceEndsAt) {
    weeksLate = Math.floor((evalAt - graceEndsAt) / WEEK_MS);
  }

  let deductionPct: number;
  if (weeksLate <= 10) {
    deductionPct = weeksLate * 0.5; // up to 5% at week 10
  } else {
    deductionPct = 5 + (weeksLate - 10) * 5; // escalated 5%/week thereafter
  }
  deductionPct = Math.min(deductionPct, 100);

  return {
    applicable: true,
    running,
    graceEndsAt,
    weeksLate,
    deductionPct,
    deductionAmount: Math.round((vendorAmount * deductionPct) / 100),
    escalated: weeksLate > 10,
    msToGrace: graceEndsAt - evalAt,
  };
}

export function formatDaysFromMs(ms: number): string {
  const days = Math.ceil(Math.abs(ms) / (24 * 60 * 60 * 1000));
  return `${days} day${days === 1 ? '' : 's'}`;
}
