/**
 * The recovery action double (IRecoveryActionInteractor and IRecoveryActionArming,
 * sdk.md D-201, D-202 "Policies setup", "The read surface").
 */
import type { ValidationRefusal } from '@web/modules/social-recovery/sdk-interfaces'

import { createWorld, eachIt, expectThrown, isHex, membersOf } from './harness'

describe('recovery action double', () => {
  it('exposes every member of the interactor and the arming seam', () => {
    const members = membersOf(createWorld().actionPart)
    ;[
      'supportsAccount',
      'isAuthority',
      'isAuthorized',
      'holdsAnyPrivilege',
      'actionInfo',
      'disarmingCall',
      'armingCall'
    ].forEach((name) => expect(members).toContain(name))
  })

  it('answers supportsAccount from whether the account holds code', async () => {
    const world = createWorld()
    world.script.code(true)
    expect(await world.actionPart.supportsAccount()).toBe(true)
    world.script.code(false)
    expect(await world.actionPart.supportsAccount()).toBe(false)
  })

  it('answers isAuthorized from the scripted authorization', async () => {
    const world = createWorld()
    world.script.authorized(true)
    expect(await world.actionPart.isAuthorized()).toBe(true)
    world.script.authorized(false)
    expect(await world.actionPart.isAuthorized()).toBe(false)
  })

  it('answers isAuthority and holdsAnyPrivilege for a held key and a fresh address', async () => {
    const world = createWorld()
    expect(await world.actionPart.isAuthority(world.keys.held)).toBe(true)
    expect(await world.actionPart.isAuthority(world.keys.fresh)).toBe(false)
    expect(await world.actionPart.holdsAnyPrivilege(world.keys.held)).toBe(true)
    expect(await world.actionPart.holdsAnyPrivilege(world.keys.fresh)).toBe(false)
  })

  it('reads the action record', async () => {
    const info = await createWorld().actionPart.actionInfo()
    expect(typeof info.name).toBe('string')
    expect(typeof info.version).toBe('string')
    expect(typeof info.supportsInterface).toBe('boolean')
  })

  it('prepares the arming and the disarming write on the account, sent by the account', async () => {
    const world = createWorld()
    const arming = await world.actionPart.armingCall()
    const disarming = await world.actionPart.disarmingCall()
    ;[arming, disarming].forEach((call) => {
      expect(call.kind).toBe('call')
      expect(call.sender).toBe('account')
      expect(call.target.toLowerCase()).toBe(world.account.toLowerCase())
      expect(isHex(call.data)).toBe(true)
    })
    expect(arming.data).not.toBe(disarming.data)
  })

  eachIt(['supportsAccount', 'isAuthorized', 'actionInfo'] as const)(
    'throws a scripted %s read failure',
    async (member) => {
      const world = createWorld()
      world.script.failRead(`action.${member}`)
      await expectThrown(() => world.actionPart[member]())
    }
  )

  eachIt(['isAuthority', 'holdsAnyPrivilege'] as const)(
    'throws a scripted %s read failure',
    async (member) => {
      const world = createWorld()
      world.script.failRead(`action.${member}`)
      await expectThrown(() => world.actionPart[member](world.keys.held))
    }
  )

  eachIt(['armingCall', 'disarmingCall'] as const)(
    'throws %s with the scripted code',
    async (member) => {
      const world = createWorld()
      world.script.refuse(`action.${member}`, 'action.unsupported')
      const error = (await expectThrown(() => world.actionPart[member]())) as ValidationRefusal
      expect(error.findings.errors.map((f) => f.code)).toContain('action.unsupported')
    }
  )
})
