/**
 * The countdown of a recovery found running on chain, kept where the wait
 * screen reads it: the session's landed state, holding the account, the
 * attempt id, the setup number and the payload hash, under the session's own
 * queue. A live gathering is never overwritten, nor a countdown of the same
 * attempt, nor one with an execution in flight; anything else, no session, a
 * wiped one or the countdown of an attempt that is no longer the one running,
 * is replaced.
 */
import { bytesToHex } from 'viem'

import type { Address } from '@web/modules/social-recovery/sdk-interfaces'
import { inQueue, recordKeys } from '@web/modules/social-recovery/shared/records'
import type {
  ChainId,
  LandedRecoverySession,
  RecordStorage,
  StoredSession,
  WalletRecords
} from '@web/modules/social-recovery/shared/records'
import { sameHash } from '@web/modules/social-recovery/shared/writes'

import type { RestoredCountdown, RestoreOutcome } from './types'

const REVISION_BYTES = 12

export const restoreCountdown = (
  storage: RecordStorage,
  records: Pick<WalletRecords, 'recoverySession'>,
  chainId: ChainId,
  account: Address,
  countdown: RestoredCountdown
): Promise<RestoreOutcome> => {
  const key = recordKeys.recoverySession(chainId, account)
  return inQueue(key, async () => {
    const current = await records.recoverySession(chainId, account).read()
    if (current.status === 'present') {
      const session = current.value
      if (session.state === 'live') {
        return 'kept'
      }
      if (
        session.state === 'landed' &&
        (session.execution ||
          (session.attemptId === countdown.attemptId.toString() &&
            session.setupNonce === countdown.setupNonce.toString() &&
            !!session.payloadHash &&
            sameHash(session.payloadHash, countdown.payloadHash)))
      ) {
        return 'kept'
      }
    }
    const landed: LandedRecoverySession = {
      state: 'landed',
      account,
      attemptId: countdown.attemptId.toString(),
      setupNonce: countdown.setupNonce.toString(),
      payloadHash: countdown.payloadHash
    }
    const record: StoredSession = {
      value: landed,
      savedAt: countdown.openedAtMs,
      revision: bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(REVISION_BYTES)))
    }
    await storage.set(key, record)
    return 'written'
  })
}
