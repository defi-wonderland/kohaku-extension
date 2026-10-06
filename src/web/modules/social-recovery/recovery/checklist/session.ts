/**
 * Opening the checklist over the records: the setup's configuration from the
 * decrypted cache or the recovery password held in memory, the stored session
 * read first, and a new gathering only where none is stored. A live session is
 * never replaced: of two tabs that open together, one writes and the other
 * reads the winner's session.
 */
import type { Address, Configuration } from '@web/modules/social-recovery/sdk-interfaces'
import { REQUEST_WINDOW_SECONDS } from '@web/modules/social-recovery/shared/client'
import { isSessionRevisionConflict } from '@web/modules/social-recovery/shared/records'
import type { SessionRead } from '@web/modules/social-recovery/shared/records'

import { NO_PAYMENT_ORDER } from './constants'
import type {
  ConfigurationInput,
  ConfigurationReading,
  GatherAgainInput,
  OpenInput,
  OpenResult
} from './types'

/**
 * The setup's configuration: the decrypted cache where this device holds it,
 * else the one the recovery password held in memory opens. With neither, the
 * holder unlocks the setup at the readout.
 */
export const configurationOf = async (input: ConfigurationInput): Promise<ConfigurationReading> => {
  const cached = await input.records.decryptedSetupCache(input.chainId, input.account).read()
  if (cached.status === 'present') {
    return { kind: 'configuration', configuration: cached.value.configuration }
  }
  if (input.password === undefined) {
    return { kind: 'none' }
  }
  const configuration: Configuration = await input.client.setup.getSetup({
    password: input.password
  })
  return { kind: 'configuration', configuration }
}

/** A stored session as what opening found. */
const resultOfRead = (read: SessionRead): OpenResult | null => {
  if (read.status !== 'present') {
    return null
  }
  const { value, revision, savedAt } = read
  if (value.state === 'live') {
    return { kind: 'live', session: value, revision, savedAt }
  }
  if (value.state === 'wiped') {
    return { kind: 'wiped', session: value, revision }
  }
  return { kind: 'landed' }
}

/**
 * Opens a new gathering over the configuration, the handover naming the
 * destination key and the key the recovery removes, and writes it as the live
 * session where none is stored. Where another tab wrote first, its session is
 * the one this tab reads.
 */
const startGathering = async (input: OpenInput, destination: Address): Promise<OpenResult> => {
  const { records, chainId, account, client, configuration } = input
  const removed = await client.walletReads.removedKey()
  const gathering = await client.recovery.initRecoveryGathering(
    configuration,
    {
      newAuthority: destination,
      ...(removed.kind === 'named' ? { removedAuthority: removed.key } : {})
    },
    NO_PAYMENT_ORDER,
    { window: REQUEST_WINDOW_SECONDS }
  )
  const accessor = records.recoverySession(chainId, account)
  try {
    const stored = await accessor.write(gathering, null)
    if (stored.value.state !== 'live') {
      throw new Error('The session write stored no live session')
    }
    return {
      kind: 'live',
      session: stored.value,
      revision: stored.revision,
      savedAt: stored.savedAt
    }
  } catch (error: unknown) {
    if (!isSessionRevisionConflict(error)) {
      throw error
    }
    const winner = resultOfRead(await accessor.read())
    if (!winner) {
      throw error
    }
    return winner
  }
}

/**
 * What the checklist opens on: the stored session where one exists, live,
 * wiped or landed, and otherwise a new gathering once the destination key is
 * known.
 */
export const openChecklist = async (input: OpenInput): Promise<OpenResult> => {
  const found = resultOfRead(
    await input.records.recoverySession(input.chainId, input.account).read()
  )
  if (found) {
    return found
  }
  if (!input.destination) {
    return { kind: 'needs-destination' }
  }
  return startGathering(input, input.destination)
}

/**
 * Gathers again after a wipe: the wiped line goes, then a new gathering
 * opens. Where the session changed since it was read, nothing is cleared and
 * the checklist opens on what is stored.
 */
export const gatherAgain = async (input: GatherAgainInput): Promise<OpenResult> => {
  try {
    await input.records.clearWipedSession(input.chainId, input.account, input.revision)
  } catch (error: unknown) {
    if (!isSessionRevisionConflict(error)) {
      throw error
    }
  }
  return openChecklist(input)
}
