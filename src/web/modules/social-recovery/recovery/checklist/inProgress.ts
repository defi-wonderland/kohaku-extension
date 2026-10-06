/**
 * The recoveries this device started and did not submit: the chain's live
 * sessions, each with its recovery entry record where one is stored. Pure.
 */
import { isAddressEqual } from 'viem'

import type {
  ListedRecord,
  ListedRecoveryEntry,
  RecoverySessionRecord
} from '@web/modules/social-recovery/shared/records'

import { startedAtOf } from './lines'
import type { InProgressItem } from './types'

export const inProgressItemsOf = (
  sessions: readonly ListedRecord<RecoverySessionRecord>[],
  entries: readonly ListedRecoveryEntry[]
): InProgressItem[] =>
  sessions.flatMap(({ account, record }) => {
    const session = record.value
    if (session.state !== 'live') {
      return []
    }
    const entry = entries.find((candidate) => isAddressEqual(candidate.account, account))
    return [
      {
        account,
        session,
        revision: record.revision,
        entry: entry ? entry.record.value : null,
        startedAt: startedAtOf(session.gathering)
      }
    ]
  })
