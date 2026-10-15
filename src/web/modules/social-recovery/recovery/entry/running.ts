/**
 * The attempt running against a looked-up account, read from the registry:
 * the attempt the registry holds as waiting at the latest block, then its
 * opening log, taken only where its payload hashes to the attempt's payload
 * hash and its setup number is the attempt's, and decoded in the action's
 * layout for the key it hands the account to. Then whose recovery it is: the
 * key the fast track made on this device, a key the wallet holds, or neither.
 */
import { keccak256 } from 'viem'

import type { Address } from '@web/modules/social-recovery/sdk-interfaces'
import { sameAddress } from '@web/modules/social-recovery/shared/client'
import type {
  ListedRecoveryEntry,
  RecoveryRoute
} from '@web/modules/social-recovery/shared/records'
import { sameHash } from '@web/modules/social-recovery/shared/writes'

import { choiceFor } from './receiving'
import type {
  AttemptReads,
  ContinueTarget,
  HeldKeySource,
  ReceivingAccountSource,
  ReceivingChoice,
  RunningAttempt,
  RunningOpening,
  RunningOwnership,
  SeedReceiver
} from './types'

/** The attempt waiting at the latest block, or null where the registry holds none waiting. */
export const readRunningAttempt = async (
  reads: AttemptReads,
  account: Address
): Promise<RunningAttempt | null> => {
  const block = await reads.latestBlock()
  const state = await reads.stateOf(account, block.number)
  const { attempt } = state
  if (attempt.state !== 'Waiting') {
    return null
  }
  return {
    attemptId: attempt.attemptId,
    setupNonce: attempt.setupNonce,
    payloadHash: attempt.payloadHash,
    consumableAfter: attempt.consumableAfter,
    setupBlock: state.setupCommittedAtBlock,
    block: block.number
  }
}

/**
 * The attempt's opening: the key its payload hands the account to and the
 * time of its block. Rejects where no opening of this attempt matches its
 * payload hash or where the payload does not decode, so the key is never
 * guessed.
 */
export const readOpening = async (
  reads: AttemptReads,
  account: Address,
  attempt: RunningAttempt
): Promise<RunningOpening> => {
  const { started } = await reads.attemptEventsOf(account, attempt.attemptId, {
    from: attempt.setupBlock,
    to: attempt.block,
    until: 'opening'
  })
  if (
    !started ||
    started.setupNonce !== attempt.setupNonce ||
    !sameHash(keccak256(started.payload), attempt.payloadHash)
  ) {
    throw new Error(`No opening of attempt ${attempt.attemptId} matches its payload hash.`)
  }
  const handover = reads.handoverOf(started.payload)
  if (!handover) {
    throw new Error(`The opening of attempt ${attempt.attemptId} does not decode.`)
  }
  const openedAt = await reads.blockTime(started.at.blockNumber)
  return { newKey: handover.newAuthority, openedAt }
}

/** The account's own keys the keystore holds, where the wallet lists the account. */
export const ownKeysOf = (
  accounts: readonly ReceivingAccountSource[],
  keys: readonly HeldKeySource[],
  account: Address
): Address[] => {
  const listed = accounts.find((candidate) => sameAddress(candidate.addr, account))
  if (!listed) {
    return []
  }
  return listed.associatedKeys.filter((associated): associated is Address =>
    keys.some((key) => sameAddress(key.addr, associated))
  )
}

/**
 * The keys the fast track made on this device: each fast track's recovery
 * entry names the account that receives control, whose key is the one the
 * fast track made.
 */
export const seedReceiversOf = (
  entries: readonly ListedRecoveryEntry[],
  choices: readonly ReceivingChoice[]
): SeedReceiver[] =>
  entries
    .filter(({ record }) => record.value.route === 'fresh-install')
    .map(({ record }) => {
      const { receivingAccount } = record.value
      return {
        key: choiceFor(choices, receivingAccount)?.key.addr ?? receivingAccount,
        receivingAccount
      }
    })

/** Whose recovery the attempt is, the fast track's key first, since the keystore holds it too. */
export const ownershipOf = (
  newKey: Address,
  seedReceivers: readonly SeedReceiver[],
  keys: readonly HeldKeySource[]
): RunningOwnership => {
  if (seedReceivers.some((seed) => sameAddress(seed.key, newKey))) {
    return 'seed'
  }
  if (keys.some((key) => sameAddress(key.addr, newKey))) {
    return 'wallet'
  }
  return 'not-yours'
}

/**
 * The entry a recovery that continues with the attempt's key is kept under:
 * the fast track's own receiving account on its route, or the wallet's
 * account whose key is the attempt's, its basic account first, on the route
 * the holder came by. Null where the wallet lists no account with that key.
 */
export const continueTargetOf = (
  newKey: Address,
  ownership: RunningOwnership,
  seedReceivers: readonly SeedReceiver[],
  choices: readonly ReceivingChoice[],
  route: RecoveryRoute
): ContinueTarget | null => {
  if (ownership === 'seed') {
    const seed = seedReceivers.find((candidate) => sameAddress(candidate.key, newKey))
    return seed ? { route: 'fresh-install', receivingAccount: seed.receivingAccount } : null
  }
  if (ownership === 'wallet') {
    const holding = choices.filter((choice) => sameAddress(choice.key.addr, newKey))
    const choice = holding.find((candidate) => !candidate.smart) ?? holding[0]
    return choice ? { route, receivingAccount: choice.address } : null
  }
  return null
}

/** Whether a key the keystore holds is an authority of the account. */
export const holdsAuthority = async (
  isAuthority: (key: Address) => Promise<boolean>,
  ownKeys: readonly Address[]
): Promise<boolean> => (await Promise.all(ownKeys.map((key) => isAuthority(key)))).some(Boolean)
