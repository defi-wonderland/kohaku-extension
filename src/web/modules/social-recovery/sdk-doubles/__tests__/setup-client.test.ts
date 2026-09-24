/**
 * The setup client double (ISetupClient, sdk.md D-202 "Policies setup", "The two
 * state records", "Restoring the configuration"; D-201 "Refusals throw").
 */
import {
  PRIVACY_LEVELS,
  RESTORE_CAUSES,
  type PreparedBatch,
  type PreparedCall,
  type RestoreRefusal,
  type ValidationRefusal
} from '@web/modules/social-recovery/sdk-interfaces'

import { createWorld, eachIt, expectThrown, isAddress, isHex, membersOf } from './harness'

const expectCall = (value: PreparedCall) => {
  expect(value.kind).toBe('call')
  expect(isAddress(value.target)).toBe(true)
  expect(value.value).toBe(0n)
  expect(isHex(value.data)).toBe(true)
  expect(['account', 'anyone']).toContain(value.sender)
  expect(typeof value.block.number).toBe('number')
  expect(isHex(value.block.hash)).toBe(true)
}

const asBatch = (value: PreparedCall | PreparedBatch) => {
  expect(value.kind).toBe('batch')
  return value as PreparedBatch
}

const asCall = (value: PreparedCall | PreparedBatch) => {
  expect(value.kind).toBe('call')
  return value as PreparedCall
}

describe('setup client double', () => {
  it('exposes every member of ISetupClient', async () => {
    const setup = await createWorld().setupClient()
    const members = membersOf(setup)
    ;[
      'validateSetup',
      'describeSetup',
      'prepareCommitSetup',
      'prepareClearSetup',
      'confirmSetup',
      'setupState',
      'getSetup'
    ].forEach((name) => {
      expect(members).toContain(name)
      expect(typeof (setup as unknown as Record<string, unknown>)[name]).toBe('function')
    })
    ;['accountFilter', 'methodFilter', 'privilegeFilter', 'fetch', 'decodeLog'].forEach((name) =>
      expect(typeof (setup.events as unknown as Record<string, unknown>)[name]).toBe('function')
    )
  })

  it('returns the two finding sets from validateSetup and the fourteen fields from describeSetup', async () => {
    const world = createWorld()
    const setup = await world.setupClient()
    const draft = world.draft('private')
    const findings = await setup.validateSetup(draft)
    expect(Array.isArray(findings.errors)).toBe(true)
    expect(Array.isArray(findings.warnings)).toBe(true)
    ;[...findings.errors, ...findings.warnings].forEach((f) => {
      expect(typeof f.code).toBe('string')
      expect(typeof f.subject).toBe('string')
      expect(typeof f.values).toBe('object')
    })
    const described = await setup.describeSetup(draft)
    expect(Object.keys(described).sort()).toEqual(
      [
        'rule',
        'wait',
        'failureDomains',
        'parties',
        'methodStanding',
        'passkeyDomains',
        'candidateKeys',
        'removedKey',
        'privacy',
        'backup',
        'reveals',
        'cancel',
        'upgrade',
        'pause'
      ].sort()
    )
  })

  it('reads the setup state record pinned to one block', async () => {
    const world = createWorld()
    world.script.setupNone()
    const state = await (await world.setupClient()).setupState()
    expect(state.hasSetup).toBe(false)
    expect(typeof state.isAuthorized).toBe('boolean')
    expect(isHex(state.setupCommitment)).toBe(true)
    expect(typeof state.setupNonce).toBe('bigint')
    expect(typeof state.setupCommittedAtBlock).toBe('number')
    expect(typeof state.attemptActive).toBe('boolean')
    expect(typeof state.block.number).toBe('number')
    expect(typeof state.block.timestamp).toBe('number')
    expect(isHex(state.block.hash)).toBe(true)
  })

  eachIt(PRIVACY_LEVELS)('reads a setup committed under the %s level', async (level) => {
    const world = createWorld()
    world.script.setupCommitted(level)
    const state = await (await world.setupClient()).setupState()
    const onChain = await world.manager.stateOf()
    expect(state.hasSetup).toBe(true)
    expect(state.setupCommitment).toBe(onChain.setupCommitment)
    expect(state.setupNonce).toBe(onChain.setupNonce)
    expect(state.setupCommittedAtBlock).toBe(onChain.setupCommittedAtBlock)
  })

  describe('prepareCommitSetup', () => {
    it('returns the atomic arming pair while the account does not authorize the action', async () => {
      const world = createWorld()
      world.script.setupNone()
      world.script.authorized(false)
      const batch = asBatch(
        await (await world.setupClient()).prepareCommitSetup(world.draft('private'), 'pw')
      )
      expect(batch.atomic).toBe(true)
      expect(batch.calls).toHaveLength(2)
      batch.calls.forEach(expectCall)
      batch.calls.forEach((c) => expect(c.sender).toBe('account'))
      batch.calls.forEach((c) => expect(c.block).toEqual(batch.block))
      expect(batch.calls[0]!.target.toLowerCase()).toBe(world.account.toLowerCase())
      expect(batch.calls[1]!.target.toLowerCase()).toBe(world.descriptor.manager.toLowerCase())
    })

    it('returns commitSetup alone once the account authorizes the action', async () => {
      const world = createWorld()
      world.script.setupCommitted('private')
      world.script.authorized(true)
      const call = asCall(
        await (await world.setupClient()).prepareCommitSetup(world.draft('private'), 'pw')
      )
      expectCall(call)
      expect(call.sender).toBe('account')
      expect(call.target.toLowerCase()).toBe(world.descriptor.manager.toLowerCase())
    })

    it('throws an ordinary error carrying the findings when scripted to refuse', async () => {
      const world = createWorld()
      world.script.refuse('prepareCommitSetup', 'rule.empty')
      const setup = await world.setupClient()
      const error = (await expectThrown(() =>
        setup.prepareCommitSetup(world.draft('private'), 'pw')
      )) as ValidationRefusal
      expect(error.findings.errors.map((f) => f.code)).toContain('rule.empty')
      expect(Array.isArray(error.findings.warnings)).toBe(true)
    })
  })

  describe('prepareClearSetup', () => {
    it('pairs clearSetup and the disarming call while a setup stands on an armed account', async () => {
      const world = createWorld()
      world.script.setupCommitted('private')
      world.script.authorized(true)
      const batch = asBatch(await (await world.setupClient()).prepareClearSetup())
      expect(batch.atomic).toBe(true)
      expect(batch.calls).toHaveLength(2)
      const targets = batch.calls.map((c) => c.target.toLowerCase()).sort()
      expect(targets).toEqual(
        [world.account.toLowerCase(), world.descriptor.manager.toLowerCase()].sort()
      )
      batch.calls.forEach((c) => expect(c.sender).toBe('account'))
    })

    it('returns clearSetup alone on a dormant setup', async () => {
      const world = createWorld()
      world.script.setupCommitted('private')
      world.script.authorized(false)
      const call = asCall(await (await world.setupClient()).prepareClearSetup())
      expect(call.target.toLowerCase()).toBe(world.descriptor.manager.toLowerCase())
      expect(call.sender).toBe('account')
    })

    it('returns the disarming call alone where no setup stands', async () => {
      const world = createWorld()
      world.script.setupNone()
      world.script.authorized(true)
      const call = asCall(await (await world.setupClient()).prepareClearSetup())
      expect(call.target.toLowerCase()).toBe(world.account.toLowerCase())
      expect(call.sender).toBe('account')
    })

    it('throws when scripted to refuse', async () => {
      const world = createWorld()
      world.script.setupCommitted('private')
      world.script.refuse('prepareClearSetup', 'action.unsupported')
      const setup = await world.setupClient()
      const error = (await expectThrown(() => setup.prepareClearSetup())) as ValidationRefusal
      expect(error.findings.errors.map((f) => f.code)).toContain('action.unsupported')
    })
  })

  it('answers confirmSetup with the confirmation record', async () => {
    const world = createWorld()
    world.script.setupNone()
    world.script.authorized(false)
    const setup = await world.setupClient()
    const draft = world.draft('private')
    const prepared = await setup.prepareCommitSetup(draft, 'pw')
    const confirmation = await setup.confirmSetup(draft, prepared)
    expect(typeof confirmation.landed).toBe('boolean')
    expect(typeof confirmation.nonce).toBe('bigint')
    expect(isHex(confirmation.setupCommitment)).toBe(true)
    expect(typeof confirmation.isAuthorized).toBe('boolean')
  })

  describe('getSetup', () => {
    it('restores the configuration from the configuration itself', async () => {
      const world = createWorld()
      const committed = world.script.setupCommitted('public')
      const restored = await (
        await world.setupClient()
      ).getSetup({ configuration: committed.configuration })
      expect(restored).toEqual(committed.configuration)
    })

    it('restores the configuration from the recovery password', async () => {
      const world = createWorld()
      const committed = world.script.setupCommitted('private')
      expect(committed.password).toBeDefined()
      const restored = await (await world.setupClient()).getSetup({ password: committed.password! })
      expect(restored).toEqual(committed.configuration)
    })

    const restoreCause = async (run: () => Promise<unknown>) => {
      const error = (await expectThrown(run)) as RestoreRefusal
      expect(RESTORE_CAUSES).toContain(error.cause.code)
      return error.cause.code
    }

    it('throws restore.no-backup where no setup stands', async () => {
      const world = createWorld()
      world.script.setupNone()
      const setup = await world.setupClient()
      expect(await restoreCause(() => setup.getSetup({ password: 'pw' }))).toBe('restore.no-backup')
    })

    it('throws restore.backup-unopened on a wrong password', async () => {
      const world = createWorld()
      world.script.setupCommitted('private')
      const setup = await world.setupClient()
      expect(await restoreCause(() => setup.getSetup({ password: 'not the password' }))).toBe(
        'restore.backup-unopened'
      )
    })

    it('throws restore.commitment-mismatch on a configuration the chain did not commit', async () => {
      const world = createWorld()
      const committed = world.script.setupCommitted('private')
      const setup = await world.setupClient()
      const other = { ...committed.configuration, wait: committed.configuration.wait + 1n }
      expect(await restoreCause(() => setup.getSetup({ configuration: other }))).toBe(
        'restore.commitment-mismatch'
      )
    })
  })

  it('throws a scripted read failure, which a screen tells from an empty setup', async () => {
    const world = createWorld()
    world.script.setupNone()
    const setup = await world.setupClient()
    const empty = await setup.setupState()
    expect(empty.hasSetup).toBe(false)
    world.script.failRead('setupState')
    await expectThrown(() => setup.setupState())
  })
})
