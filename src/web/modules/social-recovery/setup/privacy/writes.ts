import type { Address, SetupDraft } from '@web/modules/social-recovery/sdk-interfaces'
import {
  defaultSetupDraft,
  PASSWORD_SET,
  setRecoveryPassword,
  wipeRecoveryPassword
} from '@web/modules/social-recovery/shared/records'
import type { ChainId, SetupRecords } from '@web/modules/social-recovery/shared/records'

import type { OfferedLevel, PrivacyChoice } from './types'

/**
 * Stores the waiting period in the draft's wait, with the draft's path, then
 * in the record. With no draft the record alone is written, and a draft
 * started later carries its own wait. Where the record refuses after the draft
 * took the new wait, the draft gets its earlier wait back so the two agree,
 * and the refusal is thrown.
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
  await setup.writeDraftAndPath({ ...draft.value, wait })
  try {
    await setup.waitingPeriod.write(wait)
  } catch (error: unknown) {
    await setup.writeDraftAndPath(draft.value).catch(() => undefined)
    throw error
  }
}

/** The backup form a level stores in the draft: encrypted at Private, in the clear at Public. */
export const backupOfLevel = (level: OfferedLevel): SetupDraft['privacy']['backup'] =>
  level === 'private' ? 'encrypted' : 'clear'

export const levelOfBackup = (backup: SetupDraft['privacy']['backup']): OfferedLevel =>
  backup === 'clear' ? 'public' : 'private'

/**
 * The draft the privacy step starts where none is stored: the default draft,
 * with the stored waiting period as its wait where one is stored.
 */
const startedDraft = async (setup: SetupRecords): Promise<SetupDraft> => {
  const stored = await setup.waitingPeriod.read()
  const draft = defaultSetupDraft()
  return stored.status === 'present' ? { ...draft, wait: stored.value } : draft
}

/**
 * Stores the privacy level: the draft's backup form, leaving the public
 * metadata for the SDK to derive, then the password-set flag. With no draft,
 * a draft is started to carry the level. The recovery password goes to the
 * in-memory holder alone and only once storage took the rest; at Public the
 * flag and the holder are both wiped. Where the flag's write or wipe refuses
 * after the draft took the new form, the draft gets its earlier form back, or
 * the started draft is removed, so the two agree, and the refusal is thrown.
 */
export const writePrivacy = async (
  setup: SetupRecords,
  chainId: ChainId,
  account: Address,
  choice: PrivacyChoice
): Promise<void> => {
  const draft = await setup.setupDraft.read()
  const earlier = draft.status === 'present' ? draft.value : await startedDraft(setup)
  await setup.writeDraftAndPath({
    ...earlier,
    privacy: { ...earlier.privacy, backup: backupOfLevel(choice.level) }
  })
  try {
    if (choice.level === 'private') await setup.passwordSet.write(PASSWORD_SET)
    else await setup.passwordSet.wipe()
  } catch (error: unknown) {
    const rollback =
      draft.status === 'present'
        ? setup.writeDraftAndPath(draft.value)
        : Promise.all([setup.setupDraft.wipe(), setup.path.wipe()])
    await rollback.catch(() => undefined)
    throw error
  }
  if (choice.level === 'private') setRecoveryPassword(chainId, account, choice.password)
  else wipeRecoveryPassword(chainId, account)
}
