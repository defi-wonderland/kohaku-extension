/** The search key that names the account on the cancel's route. */
export const CANCEL_ACCOUNT_KEY = 'account'

/** How long the read after the claim, right before the send, may take, in ms. */
export const CLAIMED_READ_MS = 15_000

/** How long the read of the block the send starts from may take, in ms. */
export const SEND_BLOCK_READ_MS = 10_000

/** How many reads after a landed or reverted cancel look for the ending before the screen offers to check again. */
export const AFTER_READ_TRIES = 5

/** The pause between two of those reads, in ms. */
export const AFTER_READ_PAUSE_MS = 3_000

/** How often a stored cancel whose request the wallet still holds is read again, in ms. */
export const FOLLOW_POLL_MS = 2_000

/** How long the page waits for the wallet to select the account before the transfer screen, in ms. */
export const SELECT_ACCOUNT_LIMIT_MS = 10_000
