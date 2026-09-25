import { createWorld, eachIt, expectThrown, isHex } from './harness'

describe('provider double', () => {
  it('answers the descriptor’s chain and a block header', async () => {
    const world = createWorld()
    expect(await world.provider.chainId()).toBe(world.descriptor.chainId)
    const latest = await world.provider.block('latest')
    expect(typeof latest.number).toBe('number')
    expect(typeof latest.timestamp).toBe('number')
    expect(isHex(latest.hash)).toBe(true)
    expect(latest.number).toBeGreaterThanOrEqual(world.descriptor.deployedAt)
  })

  eachIt(['chainId', 'block', 'logs', 'call'] as const)(
    'throws a scripted %s failure',
    async (member) => {
      const world = createWorld()
      world.script.failRead(`provider.${member}`)
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
