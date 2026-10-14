/**
 * How a page reads a claim of a write it finds stored on this device and did
 * not write in its own live run: on arrival (a reload, a second page, a
 * reopen), at its own start, or where its own claim lost to it.
 *
 * A claim that holds a transaction hash is a send on its way to the chain:
 * the page follows that hash to its receipt, reads it dropped only where the
 * node forgets it, and never sends again for it. A claim with no hash is
 * judged by where the wallet holds the request it was queued under, with no
 * age: while the wallet's queue still holds it (a sign window open on it), it
 * is a send in flight and the page waits on it; once the wallet broadcast it,
 * the page writes that hash on the claim and follows it; where the wallet
 * holds it nowhere (a request queued and then dropped, a window the browser
 * closed), the send did not go out, never that it may still land, so the page
 * releases the claim, where it still holds no hash, and offers the start
 * again. The setup's save is the one exception: its page reads the setup and
 * the stored save between its claim and its send, so a save held nowhere
 * reads as in flight while the claim is younger than the limit past which
 * that page never sends, and is judged again once it is older. A send from a
 * key's own address carries no request the queue could be asked about, so
 * its claim with no hash reads as not sent at once. A read of the queue that
 * does not answer is read again, never taken as an answer.
 *
 * The page whose live run wrote the claim is no arrival: it keeps its own
 * in-flight state while its send runs and follows its own hash to the
 * receipt, and writes the hash on the claim once the wallet answers one (the
 * submission and the execution write the claim back with it where an arrival
 * released it meanwhile). Right before its request is added, that page asks
 * whether the claim is still its own with no hash, and adds nothing where an
 * arrival released it. A second request of the same account, sent while the
 * first one still waits in the wallet, is refused by the request queue.
 */
import type { ClaimReading, StoredClaim } from './types'

/** The first reading of a stored claim: in flight under its hash, or one whose request the wallet's queue decides. */
export const claimReadingOf = ({ transactionHash }: StoredClaim): ClaimReading =>
  transactionHash ? { kind: 'inFlight', transactionHash } : { kind: 'noHash' }
