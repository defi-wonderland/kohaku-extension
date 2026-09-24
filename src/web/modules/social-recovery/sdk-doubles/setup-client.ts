/**
 * The `ISetupClient` double (sdk.md D-201, D-202): the two judgments, the commit
 * and clear prepares with their call-or-batch shapes, the confirmation read, the
 * setup-side state record and the restore, over the shared part doubles. Every
 * read goes through a part, so a read scripted to fail there fails here.
 */
import type {
  Address,
  Configuration,
  ConfigurationSource,
  Finding,
  IEventManager,
  ISetupClient,
  PreparedBatch,
  PreparedCall,
  PrepareOptions,
  PrivacyLevel,
  SetupConfirmation,
  SetupDescription,
  SetupDraft,
  SetupState,
  ValidationResult
} from '@web/modules/social-recovery/sdk-interfaces'

import { ClientContext, pinBlock, restoreConfiguration } from './context'
import {
  clearBackup,
  placesOf,
  sameAddress,
  sealBackup,
  setupBodyOf,
  setupCommitmentOf,
  ZERO_HASH
} from './encoding'
import { composeBatch, shouldSimulate, simulationFrom, withSimulation } from './prepared'
import { finding, validationRefusal } from './scripts'

const MAX_WAIT_FIELD = 2n ** 48n

export const configurationOfDraft = (draft: SetupDraft): Configuration => ({
  clauses: draft.clauses,
  wait: draft.wait,
  ignoresPause: draft.ignoresPause
})

/**
 * The D-375 level a draft encodes: a clear backup is the public level, a
 * public note beside a sealed backup is shape-visible, and nothing public is
 * private (the default).
 */
export const levelOfDraft = (draft: SetupDraft): PrivacyLevel => {
  if (draft.privacy.backup === 'clear') return 'public'
  if (draft.privacy.publicMetadata && draft.privacy.publicMetadata !== '0x') return 'shape-visible'
  return 'private'
}

const distinctMethods = (draft: SetupDraft): Address[] => {
  const all = draft.clauses.flatMap((c) => c.credentials.map((cr) => cr.method))
  return all.filter((m, i) => all.findIndex((x) => sameAddress(x, m)) === i)
}

export class SetupClientDouble implements ISetupClient {
  readonly events: IEventManager

  constructor(private readonly ctx: ClientContext) {
    this.events = ctx.events
  }

  /** The findings of sdk.md D-205 the doubles reach over their own reads. */
  private async findings(draft: SetupDraft): Promise<ValidationResult> {
    const { chain, config, manager, action } = this.ctx
    const errors: Finding[] = []
    const warnings: Finding[] = []

    if (draft.clauses.length === 0) errors.push(finding('rule.empty', 'setup'))
    draft.clauses.forEach((clause, index) => {
      const count = clause.credentials.length
      if (count === 0) errors.push(finding('clause.empty', 'clause', { clause: index }))
      if (clause.threshold > count) {
        errors.push(
          finding('clause.threshold-above-count', 'clause', {
            clause: index,
            threshold: clause.threshold,
            count
          })
        )
      }
      if (clause.threshold > 255) {
        errors.push(
          finding('clause.threshold-too-wide', 'clause', {
            clause: index,
            threshold: clause.threshold
          })
        )
      }
      if (clause.threshold === 0)
        warnings.push(finding('clause.threshold-zero', 'clause', { clause: index }))
      if (clause.threshold === 1 && count === 1) {
        warnings.push(finding('clause.single-point', 'clause', { clause: index }))
      }
    })
    if (draft.clauses.length > 0 && draft.clauses.every((c) => c.threshold === 0)) {
      errors.push(finding('rule.all-thresholds-zero', 'setup'))
    }
    const seen = new Map<string, number>()
    placesOf(chain.account, configurationOfDraft(draft)).forEach(({ place, credential }) => {
      const key = `${credential.method.toLowerCase()}:${credential.config.toLowerCase()}`
      if (seen.has(key)) {
        errors.push(
          finding('credential.duplicate', 'credential', { places: [seen.get(key), place] })
        )
      } else seen.set(key, place)
    })
    if (draft.wait >= MAX_WAIT_FIELD)
      errors.push(finding('wait.field-width', 'setup', { wait: draft.wait }))
    const maximumWait = BigInt(config.maximumWait ?? 30 * 24 * 3600)
    if (draft.wait > maximumWait) {
      errors.push(
        finding('wait.above-maximum', 'setup', { wait: draft.wait, maximum: maximumWait })
      )
    }
    if (draft.wait === 0n) warnings.push(finding('setup.wait-zero', 'setup'))
    else if (draft.wait < BigInt(config.shortWaitBelow ?? 48 * 3600)) {
      warnings.push(finding('setup.wait-short', 'setup', { wait: draft.wait }))
    }
    if (draft.privacy.backup === 'clear') warnings.push(finding('backup.clear', 'setup'))
    if (draft.privacy.backup === 'empty') warnings.push(finding('backup.empty', 'setup'))

    // The methods a draft names: shipped, declared, stopped.
    const methodReads = await Promise.all(
      distinctMethods(draft).map(async (method) => ({
        method,
        parties: await manager.trustedParties(method),
        paused: await manager.paused(method)
      }))
    )
    methodReads.forEach(({ method, parties, paused }) => {
      if (!chain.descriptor.shippedMethods.some((m) => sameAddress(m, method))) {
        warnings.push(
          finding('method.unshipped', 'credential', {
            method,
            list: chain.descriptor.shippedMethods
          })
        )
      }
      if (parties.answered === false && !chain.method(method)) {
        warnings.push(finding('method.no-declaration', 'credential', { method }))
      }
      if (paused.answered && paused.value) {
        warnings.push(finding('method.stopped', 'credential', { method }))
      }
    })

    // The action check of D-202: the fit check read three ways, and the audit list.
    const [fits, info] = await Promise.all([action.supportsAccount(), action.actionInfo()])
    if (!fits) {
      if (config.accountImplementation) {
        if (!sameAddress(config.accountImplementation, chain.descriptor.servedImplementation)) {
          errors.push(
            finding('action.unsupported', 'action', {
              implementation: config.accountImplementation,
              served: chain.descriptor.servedImplementation
            })
          )
        }
      } else warnings.push(finding('action.fit-unchecked', 'action'))
    }
    if (
      !chain.descriptor.auditedActions.some((a) => sameAddress(a, this.ctx.actionAddress)) ||
      !info.supportsInterface
    ) {
      warnings.push(
        finding('action.unaudited', 'action', {
          action: this.ctx.actionAddress,
          list: chain.descriptor.auditedActions
        })
      )
    }
    return { errors, warnings }
  }

  async validateSetup(draft: SetupDraft): Promise<ValidationResult> {
    this.ctx.chain.guard('setup.validateSetup')
    return this.findings(draft)
  }

  async describeSetup(draft: SetupDraft): Promise<SetupDescription> {
    const { chain, config, manager, action } = this.ctx
    chain.guard('setup.describeSetup')
    const methods = distinctMethods(draft)
    const standing = await Promise.all(
      methods.map(async (method) => ({
        method,
        moduleInfo: await manager.moduleInfo(method),
        paused: await manager.paused(method),
        shipped: chain.descriptor.shippedMethods.some((m) => sameAddress(m, method))
      }))
    )
    const parties = await Promise.all(
      methods.map(async (method) => ({
        method,
        trustedParties: await manager.trustedParties(method)
      }))
    )
    const candidateKeys = await Promise.all(
      config.candidateKeys.map(async (address) => ({
        address,
        isAuthority: await action.isAuthority(address)
      }))
    )
    const [actionInfo, fits, state] = await Promise.all([
      action.actionInfo(),
      action.supportsAccount(),
      manager.stateOf()
    ])
    const removed = chain.removedKeyReading(!!config.creation)
    const level = levelOfDraft(draft)
    return {
      rule: draft.clauses.map((c, clause) => ({
        clause,
        threshold: c.threshold,
        credentials: c.credentials.map((cr) => ({ method: cr.method, label: cr.label }))
      })),
      wait: { seconds: draft.wait, defaultSeconds: BigInt(config.defaultWait ?? 48 * 3600) },
      failureDomains: methods.map((method) => ({
        method,
        places: placesOf(chain.account, configurationOfDraft(draft))
          .filter((p) => sameAddress(p.credential.method, method))
          .map((p) => p.place)
      })),
      parties,
      methodStanding: standing,
      passkeyDomains: [],
      candidateKeys,
      removedKey: removed.kind === 'named' ? removed.key : 'no-creation-triple',
      privacy: { level, publicMetadata: draft.privacy.publicMetadata },
      backup: { form: draft.privacy.backup },
      reveals: { publicMetadata: draft.privacy.publicMetadata !== '0x' },
      cancel: { attemptActive: state.attempt.state === 'Waiting' },
      upgrade: { action: this.ctx.actionAddress, actionInfo, fits },
      pause: { ignoresPause: draft.ignoresPause }
    }
  }

  async prepareCommitSetup(
    draft: SetupDraft,
    password?: string,
    options?: PrepareOptions
  ): Promise<PreparedCall | PreparedBatch> {
    const { chain, manager, action, actionAddress, config } = this.ctx
    chain.guardRefusal('setup.prepareCommitSetup')
    const block = await pinBlock(this.ctx)
    const findings = await this.findings(draft)
    if (findings.errors.length > 0) throw validationRefusal(findings)
    if (draft.privacy.backup === 'encrypted' && !password) {
      throw new Error('An encrypted backup needs a password.')
    }
    const configuration = configurationOfDraft(draft)
    const privateMetadata =
      draft.privacy.backup === 'encrypted'
        ? sealBackup(configuration, password as string)
        : draft.privacy.backup === 'clear'
        ? clearBackup(configuration)
        : '0x'
    const state = await manager.stateOf()
    const nonce = state.setupNonce + 1n
    const setupBody = setupBodyOf(chain.account, configuration)
    const setupCommitment = setupCommitmentOf(chain.account, actionAddress, nonce, setupBody)
    const commit = await manager.prepareCommitSetup(
      actionAddress,
      setupCommitment,
      nonce,
      draft.privacy.publicMetadata,
      privateMetadata
    )
    chain.registerEffect(commit.data, {
      kind: 'commit',
      setupCommitment,
      nonce,
      publicMetadata: draft.privacy.publicMetadata,
      privateMetadata,
      setupBody,
      configuration
    })
    const authorized = await action.isAuthorized()
    const simulate = shouldSimulate(options, config.simulate)
    const failure = chain.simulationFailure('setup.prepareCommitSetup')
    const from = simulationFrom(chain, 'account', options)
    if (authorized) {
      const call = { ...commit, block: { number: block.number, hash: block.hash } }
      return simulate ? withSimulation(call, from, failure) : call
    }
    const arming = await action.armingCall()
    const calls = [arming, commit].map((c) => ({
      ...c,
      block: { number: block.number, hash: block.hash }
    }))
    return composeBatch(
      simulate
        ? calls.map((c, i) => withSimulation(c, from, i === 1 ? failure : undefined))
        : calls,
      block
    )
  }

  async prepareClearSetup(options?: PrepareOptions): Promise<PreparedCall | PreparedBatch> {
    const { chain, manager, action, actionAddress, config } = this.ctx
    chain.guardRefusal('setup.prepareClearSetup')
    const block = await pinBlock(this.ctx)
    const [state, authorized] = await Promise.all([manager.stateOf(), action.isAuthorized()])
    const hasSetup = state.setupCommitment !== ZERO_HASH
    const simulate = shouldSimulate(options, config.simulate)
    const failure = chain.simulationFailure('setup.prepareClearSetup')
    const from = simulationFrom(chain, 'account', options)
    const pin = (c: PreparedCall, error = failure): PreparedCall => {
      const pinned = { ...c, block: { number: block.number, hash: block.hash } }
      return simulate ? withSimulation(pinned, from, error) : pinned
    }
    if (hasSetup && authorized) {
      const clear = await manager.prepareClearSetup(actionAddress)
      const disarm = await action.disarmingCall()
      return composeBatch([pin(clear), pin(disarm, undefined)], block)
    }
    if (hasSetup) return pin(await manager.prepareClearSetup(actionAddress))
    return pin(await action.disarmingCall())
  }

  async confirmSetup(
    draft: SetupDraft,
    prepared: PreparedCall | PreparedBatch
  ): Promise<SetupConfirmation> {
    const { chain, events, action, actionAddress } = this.ctx
    chain.guardRefusal('setup.confirmSetup')
    const calls = prepared.kind === 'batch' ? prepared.calls : [prepared]
    const commit = calls.map((c) => chain.effectOf(c.data)).find((e) => e?.kind === 'commit')
    if (!commit || commit.kind !== 'commit') {
      throw new Error('The prepared record carries no commitSetup call.')
    }
    const recomputed = setupCommitmentOf(
      chain.account,
      actionAddress,
      commit.nonce,
      setupBodyOf(chain.account, configurationOfDraft(draft))
    )
    if (recomputed !== commit.setupCommitment) {
      throw new Error('The draft does not recompute to the commitment the prepared record carries.')
    }
    const block = await pinBlock(this.ctx)
    const found = (
      await events.fetch(events.accountFilter(), { from: prepared.block.number, to: block.number })
    ).find(
      (n) =>
        n.kind === 'setup-committed' &&
        n.nonce === commit.nonce &&
        n.setupCommitment === commit.setupCommitment
    )
    const isAuthorized = await action.isAuthorized()
    return {
      landed: !!found,
      nonce: commit.nonce,
      setupCommitment: commit.setupCommitment,
      isAuthorized,
      ...(found ? { position: found.at } : {})
    }
  }

  async setupState(): Promise<SetupState> {
    const { chain, manager, action } = this.ctx
    chain.guard('setup.setupState')
    const block = await pinBlock(this.ctx)
    const [state, isAuthorized] = await Promise.all([manager.stateOf(), action.isAuthorized()])
    return {
      isAuthorized,
      hasSetup: state.setupCommitment !== ZERO_HASH,
      setupCommitment: state.setupCommitment,
      setupNonce: state.setupNonce,
      setupCommittedAtBlock: state.setupCommittedAtBlock,
      attemptActive: state.attempt.state === 'Waiting',
      block
    }
  }

  async getSetup(source: ConfigurationSource): Promise<Configuration> {
    this.ctx.chain.guardRefusal('setup.getSetup')
    return restoreConfiguration(this.ctx, source)
  }
}
