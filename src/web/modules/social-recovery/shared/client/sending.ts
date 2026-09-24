/**
 * Which key sends a prepared call (ux-interfaces.md D-370).
 *
 * Whether the extension configured a sponsor rail decides it. The first
 * release configures none (ux.md D-312), so every prepared call is sent from a
 * key the signer holds: the account's controlling key for the account's own
 * operations (a setup write, the owner's cancel, and every prepared batch,
 * which the account runs as one transaction, sdk.md D-202) and the
 * recoverer's own key for the recovery calls anyone may send (the
 * submission, the execution, the cancel by proofs).
 */
import type { PreparedBatch, PreparedCall } from '@web/modules/social-recovery/sdk-interfaces'

import type { KeyHandle } from './signer'

/** The sponsor rail this build configured: none in the first release. */
export const SPONSOR_RAIL = 'none' as const

/** The keys the signer holds that can send, by role. */
export interface SendingKeys {
  /** The account's controlling key, which signs the account's own operations. */
  accountKey?: KeyHandle
  /** The recoverer's own key, which sends the calls anyone may send. */
  recovererKey?: KeyHandle
}

/** The key that sends a prepared call or batch. Throws where the role's key was not given. */
export const sendingKeyOf = (
  prepared: PreparedCall | PreparedBatch,
  keys: SendingKeys
): KeyHandle => {
  const sender = prepared.kind === 'batch' ? 'account' : prepared.sender
  const key = sender === 'account' ? keys.accountKey : keys.recovererKey
  if (!key) {
    throw new Error(
      sender === 'account'
        ? 'A call the account sends needs the controlling key of the account.'
        : 'A call anyone may send needs the key of the recoverer in this release.'
    )
  }
  return { ...key }
}
