/**
 * The policy manager double (IPolicyManagerInteractor and its IMethodModuleReads
 * seam, sdk.md D-201, D-202 "The read surface").
 */
import {
  ATTEMPT_STATES,
  type AttemptRequest,
  type CancelRequest,
  type ValidationRefusal
} from '@web/modules/social-recovery/sdk-interfaces'

import { createWorld, eachIt, expectThrown, isAddress, isHex, membersOf } from './harness'

const MEMBERS = [
  'moduleInfo',
  'paused',
  'trustedParties',
  'stateOf',
  'hashApproval',
  'hashCancel',
  'eip712Domain',
  'name',
  'version',
  'supportsInterface',
  'prepareCommitSetup',
  'prepareClearSetup',
  'prepareStartAttempt',
  'prepareCancelByProofs',
  'prepareCancelByOwner',
  'prepareCancelByVeto'
]

describe('policy manager double', () => {
  it('exposes every member of IPolicyManagerInteractor', () => {
    const { manager } = createWorld()
    const members = membersOf(manager)
    MEMBERS.forEach((name) => expect(members).toContain(name))
  })

  it('reads stateOf with the manager’s own field names', async () => {
    const world = createWorld()
    world.script.setupCommitted('private')
    const state = await world.manager.stateOf()
    expect(isHex(state.setupCommitment)).toBe(true)
    expect(typeof state.setupNonce).toBe('bigint')
    expect(typeof state.nextAttemptId).toBe('bigint')
    expect(typeof state.setupCommittedAtBlock).toBe('number')
    expect(ATTEMPT_STATES).toContain(state.attempt.state)
  })

  it('reads the domain, the name, the version and the probe', async () => {
    const world = createWorld()
    const domain = await world.manager.eip712Domain()
    expect(isHex(domain.fields)).toBe(true)
    expect(typeof domain.name).toBe('string')
    expect(typeof domain.version).toBe('string')
    expect(domain.chainId).toBe(BigInt(world.descriptor.chainId))
    expect(domain.verifyingContract.toLowerCase()).toBe(world.descriptor.manager.toLowerCase())
    expect(Array.isArray(domain.extensions)).toBe(true)
    expect(typeof (await world.manager.name())).toBe('string')
    expect(typeof (await world.manager.version())).toBe('string')
    expect(typeof (await world.manager.supportsInterface('0x01ffc9a7'))).toBe('boolean')
  })

  it('hashes an approval and a cancel to 32 bytes', async () => {
    const world = createWorld()
    const approval = await world.manager.hashApproval({} as AttemptRequest, 0n)
    const cancel = await world.manager.hashCancel({} as CancelRequest, 0n)
    expect(approval).toMatch(/^0x[0-9a-fA-F]{64}$/)
    expect(cancel).toMatch(/^0x[0-9a-fA-F]{64}$/)
  })

  describe('the three module reads', () => {
    it('answer the scripted declaration, stop and module record', async () => {
      const world = createWorld()
      const module = world.descriptor.methodZkpassport
      const parties = {
        admin: world.keys.held,
        pendingAdmin: world.keys.fresh,
        trustedKeys: [`0x${'22'.repeat(32)}` as const],
        pauseHolder: world.keys.held,
        pendingPauseHolder: world.keys.fresh
      }
      world.script.method(module, {
        paused: true,
        trustedParties: parties,
        moduleInfo: { name: 'zkPassport', version: '1.0.0', supportsInterface: true }
      })
      expect(await world.manager.paused(module)).toEqual({ answered: true, value: true })
      expect(await world.manager.trustedParties(module)).toEqual({ answered: true, value: parties })
      expect(await world.manager.moduleInfo(module)).toEqual({
        answered: true,
        value: { name: 'zkPassport', version: '1.0.0', supportsInterface: true }
      })
    })

    eachIt(['moduleInfo', 'paused', 'trustedParties'] as const)(
      'tell a failed %s read from an answer',
      async (member) => {
        const world = createWorld()
        const module = world.descriptor.methodEcdsa
        const answered = await world.manager[member](module)
        expect(answered.answered).toBe(true)
        world.script.failRead(member)
        let result: { answered: boolean } | undefined
        try {
          result = await world.manager[member](module)
        } catch (e) {
          expect(e).toBeInstanceOf(Error)
        }
        // D-202 "The read surface": a module read that failed says it was not
        // answered, never an answered default.
        if (result) expect(result).toEqual({ answered: false })
      }
    )
  })

  eachIt(['stateOf', 'eip712Domain', 'name', 'version'] as const)(
    'throws a scripted %s read failure',
    async (member) => {
      const world = createWorld()
      world.script.failRead(member)
      await expectThrown(() => world.manager[member]())
    }
  )

  describe('the six prepares', () => {
    it('encode the contract’s own call with the right sender', async () => {
      const world = createWorld()
      world.script.setupCommitted('private')
      world.script.attempt('pending')
      const { manager, descriptor, account } = world
      const cases = [
        [
          await manager.prepareCommitSetup(
            descriptor.action,
            `0x${'00'.repeat(32)}`,
            1n,
            '0x',
            '0x'
          ),
          'account'
        ],
        [await manager.prepareClearSetup(descriptor.action), 'account'],
        [await manager.prepareCancelByOwner(descriptor.action), 'account'],
        [await manager.prepareStartAttempt({} as AttemptRequest), 'anyone'],
        [await manager.prepareCancelByProofs({} as CancelRequest), 'anyone'],
        [
          await manager.prepareCancelByVeto(account, descriptor.action, 1n, descriptor.methodEcdsa),
          'anyone'
        ]
      ] as const
      cases.forEach(([call, sender]) => {
        expect(call.kind).toBe('call')
        expect(call.sender).toBe(sender)
        expect(call.target.toLowerCase()).toBe(descriptor.manager.toLowerCase())
        expect(isAddress(call.target)).toBe(true)
        expect(isHex(call.data)).toBe(true)
      })
    })

    it('throw with the scripted code', async () => {
      const world = createWorld()
      world.script.refuse('prepareClearSetup', 'action.unsupported')
      const error = (await expectThrown(() =>
        world.manager.prepareClearSetup(world.descriptor.action)
      )) as ValidationRefusal
      expect(error.findings.errors.map((f) => f.code)).toContain('action.unsupported')
    })
  })
})
