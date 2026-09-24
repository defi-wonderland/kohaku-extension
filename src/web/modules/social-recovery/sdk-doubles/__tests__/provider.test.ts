/**
 * The provider double (IProvider, sdk.md D-208): four reads, no send, no
 * subscription, no code read; a read it could not make is a failure and never
 * an empty answer.
 */
import { createWorld, eachIt, expectThrown, isHex, membersOf } from './harness'

describe('provider double', () => {
  it('exposes the four reads and nothing that sends', () => {
    const members = membersOf(createWorld().provider)
    ;['chainId', 'call', 'logs', 'block'].forEach((name) => expect(members).toContain(name))
    ;['send', 'sendTransaction', 'getCode', 'subscribe', 'on'].forEach((name) =>
      expect(members).not.toContain(name)
    )
  })

  it('answers the descriptor’s chain and a block header', async () => {
    const world = createWorld()
    expect(await world.provider.chainId()).toBe(world.descriptor.chainId)
    const latest = await world.provider.block('latest')
    expect(typeof latest.number).toBe('number')
    expect(typeof latest.timestamp).toBe('number')
    expect(isHex(latest.hash)).toBe(true)
    expect(latest.number).toBeGreaterThanOrEqual(world.descriptor.deployedAt)
  })

  it('answers logs as raw logs', async () => {
    const world = createWorld()
    world.script.setupCommitted('private')
    const latest = await world.provider.block('latest')
    const logs = await world.provider.logs(world.events.accountFilter(), {
      from: world.descriptor.deployedAt,
      to: latest.number
    })
    logs.forEach((log) => {
      expect(isHex(log.data)).toBe(true)
      expect(Array.isArray(log.topics)).toBe(true)
      expect(typeof log.blockNumber).toBe('number')
      expect(typeof log.logIndex).toBe('number')
    })
  })

  eachIt(['chainId', 'block', 'logs', 'call'] as const)(
    'throws a scripted %s failure',
    async (member) => {
      const world = createWorld()
      world.script.failRead(member)
      const run = {
        chainId: () => world.provider.chainId(),
        block: () => world.provider.block('latest'),
        logs: () => world.provider.logs(world.events.accountFilter(), { from: 0, to: 1 }),
        call: () => world.provider.call(world.descriptor.manager, '0x', undefined, 'latest')
      }
      await expectThrown(run[member])
    }
  )
})
