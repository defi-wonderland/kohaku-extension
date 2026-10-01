/**
 * How long one read of the check after a landed save may take before it reads
 * as unanswered, in ms.
 */
export const CONFIRM_READ_TIMEOUT_MS = 60_000

/** The code the SDK's check throws when the setup it rebuilds differs from the one committed. */
export const COMMITMENT_MISMATCH_CODE = 'confirm.commitment-mismatch'
