/**
 * The overview's three writes over the save's own steps and run: the
 * re-authorize commits the same body again through the save's prepare, and
 * the two removals prepare the clear or the zero write of the authorization
 * in its place. Every write keeps the save's request queue, its stored write
 * in flight, its receipt waits and its check after the landing.
 *
 * The save's setup read becomes the read of whether the write's end already
 * stands on the chain: a run that finds it at its start sends nothing, and a
 * followed write that finds it landed is checked as after its receipt. A
 * removal's check agrees once the read finds the removal's end.
 *
 * The re-authorize reads the attempt again before it prepares and refuses
 * while one is open, since the wallet keeps the cancel and the repair apart;
 * it tells its step, so the overview reads the chain again and draws why.
 */
import type {
  PreparedBatch,
  PreparedCall,
  SetupConfirmation
} from '@web/modules/social-recovery/sdk-interfaces'
import { accountBatchTransactionOf } from '@web/modules/social-recovery/shared/client'
import {
  assertWriteDoor,
  checkGas,
  requestIdOf,
  walletAccountRefOf
} from '@web/modules/social-recovery/shared/writes'
import { callsOf, saveStepsOf } from '@web/modules/social-recovery/setup/arm'
import type { PreparedSave, SaveSteps } from '@web/modules/social-recovery/setup/arm'

import { attemptOpenOf, goalStands } from './readings'
import type { OverviewStepsInput } from './types'

export const overviewStepsOf = (input: OverviewStepsInput): SaveSteps => {
  const { intent, client, facts, key } = input
  const save = saveStepsOf({ ...input, setup: input.records.setup(input.chainId, input.account) })
  const inFlight = input.records.saveInFlight(input.chainId, input.account)

  const prepareRemoval = async (): Promise<PreparedSave> => {
    const prepared: PreparedCall | PreparedBatch =
      intent === 'clear'
        ? await client.setup.prepareClearSetup()
        : await client.setup.prepareRemoveAuthorization()
    assertWriteDoor('ownerWrite', prepared)
    return { draft: input.draft, prepared, calls: callsOf(prepared) }
  }

  const removalConfirmation = async (): Promise<SetupConfirmation> => {
    const state = await client.setup.setupState()
    const ended = goalStands(intent, state)
    return {
      landed: ended,
      isAuthorized: ended,
      nonce: state.setupNonce,
      setupCommitment: state.setupCommitment
    }
  }

  return {
    ...save,
    hasSetup: async () => goalStands(intent, await client.setup.setupState()),
    newRequestId: () => requestIdOf(intent),
    async prepare(): Promise<PreparedSave> {
      if (intent !== 'reauthorize') {
        return prepareRemoval()
      }
      // A run that follows a stored write needs no draft; a new one commits only the path it read.
      if (input.draft.clauses.length === 0) {
        throw new Error('The re-authorize has no path to commit again.')
      }
      if (input.draft.privacy.backup === 'encrypted' && input.password === undefined) {
        throw new Error('The re-authorize seals the setup again and needs the recovery password.')
      }
      const [state, attempt] = await Promise.all([
        client.setup.setupState(),
        client.walletReads.attemptState()
      ])
      if (attemptOpenOf(state, attempt)) {
        input.onAttemptOpen()
        throw new Error('This wallet does not re-authorize while a recovery is in progress.')
      }
      return save.prepare()
    },
    checkGas:
      intent === 'reauthorize'
        ? save.checkGas
        : ({ prepared, calls }) =>
            checkGas({
              write: 'ownerWrite',
              prepared,
              key,
              reads: input.reads,
              network: facts.network,
              transaction: accountBatchTransactionOf(facts, key, calls),
              operates: walletAccountRefOf(facts)
            }),
    confirm: intent === 'reauthorize' ? save.confirm : removalConfirmation,
    async wipe(): Promise<void> {
      const held = await inFlight.read()
      if (held.status === 'present') {
        await inFlight.release(held.value.requestId)
      }
      const cache = input.records.decryptedSetupCache(input.chainId, input.account)
      if (intent === 'clear') {
        await cache.wipe()
        return
      }
      // The cache takes the path the landed write committed, the stored write's own;
      // a run with no path of its own leaves the cache as it stands.
      const committed = held.status === 'present' ? held.value.draft : input.draft
      if (intent === 'reauthorize' && committed.clauses.length > 0) {
        const state = await client.setup.setupState()
        await cache.write({
          configuration: {
            clauses: committed.clauses,
            wait: committed.wait,
            ignoresPause: committed.ignoresPause
          },
          setupNonce: state.setupNonce,
          setupCommitment: state.setupCommitment
        })
      }
    }
  }
}
