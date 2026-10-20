/**
 * The fake node under the real SDK: a seeded setup reads back through the
 * SDK's setup client and restores from its sealed backup, a landed prepared
 * batch changes what the manager answers, and a failed read rejects as the
 * provider would, a revert in the SDK's revert shape. A deployment that
 * disagrees with the build, and a privilege write, answer as they were seeded.
 */
import {
  isProviderRevert,
  SocialRecoveryBuilder,
  configurationCommitment,
  METHOD_ECDSA_CONFIG_ABI
} from '@kohaku-eth/social-recovery'
import type { Address, Configuration, DeploymentDescriptor } from '@kohaku-eth/social-recovery'
import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  zeroAddress,
  zeroHash
} from 'viem'

import { ACTION_IMMUTABLES_ABI } from '@web/modules/social-recovery/shared/client/abi'
import { ScriptedNode } from '@web/modules/social-recovery/shared/client/scripted'

const at = (n: number): Address => `0x${n.toString(16).padStart(40, '0')}` as Address

const DESCRIPTOR: DeploymentDescriptor = {
  chainId: 11155111,
  manager: at(0xc70101),
  methodEcdsa: at(0xc70102),
  methodPasskey: at(0xc70103),
  methodAadhaar: at(0xc70104),
  methodZkpassport: at(0xc70105),
  action: at(0xc70106),
  servedImplementation: at(0xa11ce),
  deployedAt: 0,
  digestVersion: '1',
  managerVersion: '1.0.0',
  shippedMethods: [at(0xc70102), at(0xc70103)],
  auditedActions: [at(0xc70106)]
}
const ACCOUNT = at(0xacc0)
const GUARDIAN = at(0x6a12d)

const CONFIGURATION: Configuration = {
  wait: 3 * 24 * 3600,
  ignoresPause: false,
  clauses: [
    {
      threshold: 1,
      credentials: [
        {
          method: DESCRIPTOR.methodEcdsa,
          config: encodeAbiParameters(METHOD_ECDSA_CONFIG_ABI, [GUARDIAN])
        }
      ]
    }
  ]
}

const nodeOf = () =>
  new ScriptedNode({ descriptor: DESCRIPTOR, account: ACCOUNT, clock: () => 1_790_000_000 })

const clientsOver = (node: ScriptedNode) =>
  SocialRecoveryBuilder.from({ provider: node, account: ACCOUNT, descriptor: DESCRIPTOR }).build()

describe('the fake node under the SDK', () => {
  it('reads a seeded setup back through the setup client and restores it from its backup', async () => {
    const node = nodeOf()
    const { nonce, setupCommitment } = await node.commitSetup(
      CONFIGURATION,
      { publicMetadata: '0x', backup: 'encrypted' },
      'correct horse'
    )
    const { setupClient } = await clientsOver(node)

    const state = await setupClient.setupState()
    expect(state.hasSetup).toBe(true)
    expect(state.setupNonce).toBe(nonce)
    expect(state.setupCommitment).toBe(setupCommitment)
    const restored = await setupClient.getSetup({ password: 'correct horse' })
    expect(configurationCommitment(restored, ACCOUNT, DESCRIPTOR.action, nonce)).toBe(
      setupCommitment
    )
  })

  it('lands a prepared commit, so the manager holds it and the account authorizes the action', async () => {
    const node = nodeOf()
    const { setupClient } = await clientsOver(node)
    const draft = {
      ...CONFIGURATION,
      privacy: { publicMetadata: '0x', backup: 'empty' }
    } as const
    expect((await setupClient.setupState()).hasSetup).toBe(false)

    const prepared = await setupClient.prepareCommitSetup(draft)
    expect(prepared.kind).toBe('batch')
    node.land(prepared)

    const state = await setupClient.setupState()
    expect(state.hasSetup).toBe(true)
    expect(state.isAuthorized).toBe(true)
    expect((await setupClient.confirmSetup(draft, prepared)).landed).toBe(true)
  })

  it('answers a deployment that disagrees with the build as it was seeded, through the SDK', async () => {
    const node = nodeOf()
    node.setChainId(1)
    await expect(clientsOver(node)).rejects.toThrow()

    const other = nodeOf()
    other.setDomain({ version: '2' })
    await expect(clientsOver(other)).rejects.toThrow()

    const moved = nodeOf()
    moved.setConstants({ manager: GUARDIAN })
    const answer = await moved.call(
      DESCRIPTOR.action,
      encodeFunctionData({ abi: ACTION_IMMUTABLES_ABI, functionName: 'MANAGER' }),
      zeroAddress,
      'latest'
    )
    expect(
      decodeFunctionResult({ abi: ACTION_IMMUTABLES_ABI, functionName: 'MANAGER', data: answer })
    ).toBe(getAddress(GUARDIAN))

    moved.setContractCode(DESCRIPTOR.manager, false)
    await expect(moved.code(DESCRIPTOR.manager, 'latest')).resolves.toBe('0x')
    await expect(
      moved.call(
        DESCRIPTOR.manager,
        encodeFunctionData({ abi: ACTION_IMMUTABLES_ABI, functionName: 'MANAGER' }),
        zeroAddress,
        'latest'
      )
    ).resolves.toBe('0x')
  })

  it('writes a privilege on the account with its log, as the account would', async () => {
    const node = nodeOf()
    node.setPrivilege(GUARDIAN)
    const { setupClient } = await clientsOver(node)
    const writes = await setupClient.events.fetch(setupClient.events.privilegeFilter(), {
      from: 0,
      to: node.head.number
    })
    expect(writes).toMatchObject([{ kind: 'privilege-changed', addr: getAddress(GUARDIAN) }])

    node.setPrivilege(GUARDIAN, zeroHash)
    expect(node.privileges.has(GUARDIAN.toLowerCase())).toBe(false)
  })

  it('rejects a failed read as a transport failure, and a scripted revert in the revert shape', async () => {
    const node = nodeOf()
    const { setupClient } = await clientsOver(node)
    node.failRead('stateOf')
    await expect(setupClient.setupState()).rejects.toThrow()

    node.failRead('stateOf', { kind: 'revert', data: '0xdeadbeef' })
    const thrown = await setupClient.setupState().catch((error: unknown) => error)
    expect(isProviderRevert(thrown)).toBe(true)

    node.restoreRead()
    expect((await setupClient.setupState()).setupCommitment).toBe(zeroHash)
  })
})
