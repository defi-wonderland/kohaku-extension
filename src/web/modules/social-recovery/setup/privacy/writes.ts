import type { Address, SetupDraft } from '@web/modules/social-recovery/sdk-interfaces'
import {
  PASSWORD_SET,
  setRecoveryPassword,
  wipeRecoveryPassword
} from '@web/modules/social-recovery/shared/records'
import type { ChainId, SetupRecords } from '@web/modules/social-recovery/shared/records'

import type { OfferedLevel, PrivacyChoice } from './types'

/**
 * Stores the waiting period in the draft's wait, then in the record. With no
 * draft the record alone is written, and a draft started later carries its own
 * wait. Where the record refuses after the draft took the new wait, the draft
 * gets its earlier wait back so the two agree, and the refusal is thrown.
 */
export const writeWaitingPeriod = async (
  setup: SetupRecords,
  wait: SetupDraft['wait']
): Promise<void> => {
  const draft = await setup.setupDraft.read()
  if (draft.status !== 'present') {
    await setup.waitingPeriod.write(wait)
    return
  }
  await setup.setupDraft.write({ ...draft.value, wait })
  try {
    await setup.waitingPeriod.write(wait)
  } catch (error: unknown) {
    await setup.setupDraft.write(draft.value).catch(() => undefined)
    throw error
  }
}

/** The backup form a level stores in the draft: encrypted at Private, in the clear at Public. */
export const backupOfLevel = (level: OfferedLevel): SetupDraft['privacy']['backup'] =>
  level === 'private' ? 'encrypted' : 'clear'

export const levelOfBackup = (backup: SetupDraft['privacy']['backup']): OfferedLevel =>
  backup === 'clear' ? 'public' : 'private'

/**
 * Stores the privacy level: the draft's backup form, leaving the public
 * metadata for the SDK to derive, then the password-set flag. The recovery
 * password goes to the in-memory holder alone and only once storage took the
 * rest; at Public the flag and the holder are both wiped.
 */
export const writePrivacy = async (
  setup: SetupRecords,
  chainId: ChainId,
  account: Address,
  choice: PrivacyChoice
): Promise<void> => {
  const draft = await setup.setupDraft.read()
  if (draft.status === 'present') {
    await setup.setupDraft.write({
      ...draft.value,
      privacy: { ...draft.value.privacy, backup: backupOfLevel(choice.level) }
    })
  }
  if (choice.level === 'private') {
    await setup.passwordSet.write(PASSWORD_SET)
    setRecoveryPassword(chainId, account, choice.password)
  } else {
    await setup.passwordSet.wipe()
    wipeRecoveryPassword(chainId, account)
  }
}
