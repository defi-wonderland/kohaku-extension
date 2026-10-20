/**
 * The setup client a screen uses confirms a save only for the draft the
 * prepared commit carries: a draft that does not recompute to that
 * commitment is refused with the code the arm screen reads as a mismatch.
 */
import { METHOD_ECDSA_CONFIG_ABI } from '@kohaku-eth/social-recovery'
import type { SetupDraft } from '@kohaku-eth/social-recovery'
import { encodeAbiParameters } from 'viem'

import { addressOf } from '@web/modules/social-recovery/shared/client/__fixtures__/addresses'
import { addressBookOf } from '@web/modules/social-recovery/shared/client/addresses'
import { buildRecoveryClient } from '@web/modules/social-recovery/shared/client/build-client'
import { descriptorOf } from '@web/modules/social-recovery/shared/client/descriptors'
import { sdkStandIn } from '@web/modules/social-recovery/shared/client/stand-in'

jest.mock('@web/modules/social-recovery/shared/client/deployment-env', () => ({
  ...jest.requireActual('@web/modules/social-recovery/shared/client/deployment-env'),
  sepoliaDeploymentVariable: () => undefined
}))

const ACCOUNT = addressOf('account')

const draftWaiting = (wait: number): SetupDraft => ({
  wait,
  ignoresPause: false,
  privacy: { publicMetadata: '0x', backup: 'empty' },
  clauses: [
    {
      threshold: 1,
      credentials: [
        {
          method: descriptorOf('sepolia', addressBookOf('sepolia')).methodEcdsa,
          config: encodeAbiParameters(METHOD_ECDSA_CONFIG_ABI, [addressOf('guardian')])
        }
      ]
    }
  ]
})

describe('the setup client confirmSetup', () => {
  it('refuses a draft that does not recompute to the prepared commitment as a mismatch', async () => {
    sdkStandIn.reset()
    const addressBook = addressBookOf('sepolia')
    const node = sdkStandIn.nodeFor(descriptorOf('sepolia', addressBook), ACCOUNT)
    const client = await buildRecoveryClient({
      chain: 'sepolia',
      account: ACCOUNT,
      addressBook,
      provider: node
    })
    const prepared = await client.setup.prepareCommitSetup(draftWaiting(3 * 24 * 3600))
    node.land(prepared)

    await expect(
      client.setup.confirmSetup(draftWaiting(4 * 24 * 3600), prepared)
    ).rejects.toMatchObject({ name: 'CodedRefusal', code: 'confirm.commitment-mismatch' })
  })
})
