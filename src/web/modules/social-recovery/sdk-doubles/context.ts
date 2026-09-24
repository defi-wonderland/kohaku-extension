/**
 * What the two client doubles are built over: the scripted chain, the shared
 * parts (one instance each, per sdk.md D-201), the client configuration and the
 * codec registry. The builder double assembles it; a test may assemble it too.
 * Also the configuration restore of sdk.md D-202, which both clients run.
 */
import type {
  Address,
  BlockHeader,
  BlockTag,
  ClientConfiguration,
  Configuration,
  ConfigurationSource,
  IActionCodec,
  IEventManager,
  IPolicyManagerInteractor,
  IProvider,
  IRecoveryActionInteractor
} from '@web/modules/social-recovery/sdk-interfaces'

import type { ScriptedChain } from './chain'
import { readBackup, sameAddress, setupBodyOf, setupCommitmentOf, ZERO_HASH } from './encoding'
import { restoreRefusal } from './scripts'

/**
 * The parts both clients share. The action part travels as
 * `IRecoveryActionInteractor` alone: the arming seam goes to the setup client's
 * constructor beside this context and to nothing else (sdk.md D-201 drawing).
 */
export interface ClientContext {
  chain: ScriptedChain
  provider: IProvider
  manager: IPolicyManagerInteractor
  action: IRecoveryActionInteractor
  /** The action address the client is bound to (the builder's `.action(address, …)`). */
  actionAddress: Address
  events: IEventManager
  config: ClientConfiguration
  codecs: IActionCodec<unknown>[]
}

/**
 * The block tags sdk.md D-208 defaults a client to when its configuration names
 * none: `latest` for reading and `finalized` for watching (reasons in D-203
 * "Reorgs and finality").
 */
export const DEFAULT_BLOCK_TAGS: { read: BlockTag; watch: BlockTag } = {
  read: 'latest',
  watch: 'finalized'
}

/** The client configuration the doubles default to, with the shipped numbers of D-208. */
export const defaultClientConfiguration = (
  overrides: Partial<ClientConfiguration> = {}
): ClientConfiguration => ({
  tokens: [],
  candidateKeys: [],
  blockTags: { ...DEFAULT_BLOCK_TAGS },
  logChunkWidth: 10_000,
  simulate: true,
  defaultWait: 48 * 3600,
  shortWaitBelow: 48 * 3600,
  maximumWait: 30 * 24 * 3600,
  requestWindow: { default: 24 * 3600, floor: 3600, ceiling: 72 * 3600 },
  cancelWindow: 12 * 3600,
  ruleCostBound: 10_000_000n,
  ...overrides
})

export const codecFor = (ctx: ClientContext, action: Address): IActionCodec<unknown> | undefined =>
  ctx.codecs.find((c) => c.actions.some((a) => sameAddress(a, action)))

/** The block a read pins at: the configuration's read tag, or D-208's default `latest`. */
export const pinBlock = (ctx: ClientContext): Promise<BlockHeader> =>
  ctx.provider.block((ctx.config.blockTags ?? DEFAULT_BLOCK_TAGS).read)

/**
 * The restore of sdk.md D-202 "Restoring the configuration": pin a block, read
 * `stateOf`, open the latest `SetupCommitted`'s backup with the password (or take
 * the configuration given), then check the commitment. Throws a
 * `RestoreRefusal` naming the step that refused.
 */
export const restoreConfiguration = async (
  ctx: ClientContext,
  source: ConfigurationSource,
  pinned?: BlockHeader
): Promise<Configuration> => {
  const block = pinned ?? (await pinBlock(ctx))
  const state = await ctx.manager.stateOf()
  if (state.setupCommitment === ZERO_HASH) {
    throw restoreRefusal('restore.no-backup', { setup: 'none' })
  }
  let configuration: Configuration
  if ('password' in source) {
    const notifications = await ctx.events.fetch(ctx.events.accountFilter(), {
      from: state.setupCommittedAtBlock,
      to: block.number
    })
    const latest = notifications
      .filter((n) => n.kind === 'setup-committed')
      .reverse()
      .find((n) => n.kind === 'setup-committed' && n.nonce === state.setupNonce)
    if (!latest || latest.kind !== 'setup-committed') {
      throw restoreRefusal('restore.no-backup', { setup: 'standing', backup: 'none' })
    }
    const reading = readBackup(latest.privateMetadata, source.password)
    if (reading.form === 'empty') {
      throw restoreRefusal('restore.no-backup', { setup: 'standing', backup: 'none' })
    }
    // The clear backup has no reader here (sdk.md D-202): its holder passes the configuration.
    if (reading.form !== 'encrypted' || !reading.opened) {
      throw restoreRefusal('restore.backup-unopened')
    }
    configuration = reading.configuration
  } else {
    configuration = source.configuration
  }
  const recomputed = setupCommitmentOf(
    ctx.chain.account,
    ctx.actionAddress,
    state.setupNonce,
    setupBodyOf(ctx.chain.account, configuration)
  )
  if (recomputed !== state.setupCommitment) {
    throw restoreRefusal('restore.commitment-mismatch', {
      committed: state.setupCommitment,
      recomputed
    })
  }
  return configuration
}
