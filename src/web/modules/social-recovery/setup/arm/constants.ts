/**
 * How long one read of the check after a landed save may take before it reads
 * as unanswered, in ms.
 */
export const CONFIRM_READ_TIMEOUT_MS = 60_000

/**
 * The longest wait for a new block before each further read of the check, in
 * ms: a few blocks of the recovery chain. A read's own limit caps it too.
 */
export const NEW_BLOCK_WAIT_MS = 30_000

/**
 * How many more times the check reads, each after a new block, where it did
 * not find the setup on chain, before the save reads the commitment's mismatch.
 */
export const CONFIRM_REREAD_BLOCKS = 3

/**
 * The longest a wait for the receipt of a sent batch runs before the save
 * reads stalled and offers to check again, in ms: the first wait, counted from
 * the hash's arrival, and each wait after it.
 */
export const RECEIPT_WAIT_MS = 120_000

/** How often the wait for a new block reads the chain's block number, in ms. */
export const BLOCK_POLL_MS = 2_000

/** The code the SDK's check throws when the setup it rebuilds differs from the one committed. */
export const COMMITMENT_MISMATCH_CODE = 'confirm.commitment-mismatch'
