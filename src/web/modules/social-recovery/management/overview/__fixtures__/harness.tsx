/**
 * Mounts the overview's view in jsdom with the light theme, over given reads
 * or over the overview's own reads hook on a client built over the stand-in's
 * scripted chain, with real records on an in-memory storage. jsdom has no
 * `TextEncoder`, which viem reads when it loads, so the harness sets Node's
 * before it loads the modules.
 */
import { TextDecoder, TextEncoder } from 'util'

import type {
  OverviewReads,
  OverviewViewProps
} from '@web/modules/social-recovery/management/overview/types'
import type {
  Configuration,
  PrivacyLevel,
  SetupState
} from '@web/modules/social-recovery/sdk-interfaces'
import type { RecoveryKitClient } from '@web/modules/social-recovery/shared/client'
import type { RecordStorage } from '@web/modules/social-recovery/shared/records'

import type { ClientState, ReadsProbeProps, World } from './types'

Object.assign(globalThis, { TextEncoder, TextDecoder })

// The stand-in's chain answers the overview's client; no deployment variable
// from a developer's environment turns it into the deployed kit.
jest.mock('@web/modules/social-recovery/shared/client/deployment-env', () => ({
  SEPOLIA_DEPLOYMENT_VARIABLE: 'SOCIAL_RECOVERY_SEPOLIA_DEPLOYMENT',
  sepoliaDeploymentVariable: () => undefined
}))

/* eslint-disable @typescript-eslint/no-var-requires, global-require */
const React: typeof import('react') = require('react')
const cancelMount: typeof import('@web/modules/social-recovery/cancel/__fixtures__/mount') = require('@web/modules/social-recovery/cancel/__fixtures__/mount')
const {
  addressBookOf,
  buildRecoveryClient,
  descriptorOf,
  WALLET_RECOVERY_CHAIN
}: typeof import('@web/modules/social-recovery/shared/client') = require('@web/modules/social-recovery/shared/client')
const {
  sdkStandIn
}: typeof import('@web/modules/social-recovery/shared/client/stand-in') = require('@web/modules/social-recovery/shared/client/stand-in')
const {
  ecdsaConfigOf
}: typeof import('@web/modules/social-recovery/shared/client/kit/formats/credentials') = require('@web/modules/social-recovery/shared/client/kit/formats/credentials')
const {
  createWalletRecords
}: typeof import('@web/modules/social-recovery/shared/records') = require('@web/modules/social-recovery/shared/records')
const {
  makeStorage
}: typeof import('@web/modules/social-recovery/shared/records/__fixtures__/storage') = require('@web/modules/social-recovery/shared/records/__fixtures__/storage')
const OverviewView: typeof import('@web/modules/social-recovery/management/overview/OverviewView').default =
  require('@web/modules/social-recovery/management/overview/OverviewView').default
const {
  useOverviewReads
}: typeof import('@web/modules/social-recovery/management/overview/useOverviewReads') = require('@web/modules/social-recovery/management/overview/useOverviewReads')
/* eslint-enable @typescript-eslint/no-var-requires, global-require */

export const { mount, t, act, settle } = cancelMount

export const ADDRESS_BOOK = addressBookOf(WALLET_RECOVERY_CHAIN)
export const ACCOUNT = '0x00000000000000000000000000000000000A11cE' as const
export const GUARDIAN = '0x00000000000000000000000000000000000B0b00' as const
export const HASH = `0x${'11'.repeat(32)}` as const
export const PASSWORD = 'card password'

export const CONFIGURATION: Configuration = {
  clauses: [
    {
      threshold: 1,
      credentials: [{ method: ADDRESS_BOOK.methods.ecdsa, config: ecdsaConfigOf(GUARDIAN) }]
    }
  ],
  wait: 172_800n,
  ignoresPause: true
}

export const CONTEXT: OverviewViewProps['context'] = {
  addressBook: ADDRESS_BOOK,
  ownRpIdHash: HASH
}

/** Types into a field the way a holder does, so React hears the change. */
export const typeInto = async (container: HTMLElement | null, value: string): Promise<void> => {
  const input =
    container instanceof HTMLInputElement ? container : container?.querySelector('input')
  if (!input) {
    throw new Error('no field to type into')
  }
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await settle()
}

/** A setup state with the given fields over a committed, authorized one. */
export const setupStateOf = (fields: Partial<SetupState> = {}): SetupState => ({
  isAuthorized: true,
  hasSetup: true,
  setupCommitment: HASH,
  setupNonce: 1n,
  setupCommittedAtBlock: 100,
  attemptActive: false,
  block: { number: 200, timestamp: 2_000, hash: HASH },
  ...fields
})

/** Reads as the view takes them, each move a mock. */
export const readsOf = (fields: Partial<OverviewReads> = {}): OverviewReads => ({
  facts: { status: 'pending' },
  path: { kind: 'none' },
  ask: { status: 'idle' },
  notices: { status: 'answered', value: { moved: [], cancelledAttempts: [] } },
  retry: jest.fn(),
  retryPath: jest.fn(),
  retryNotices: jest.fn(),
  unlock: jest.fn(),
  askAgain: jest.fn(),
  ...fields
})

/** The view's props over given reads, each callback a mock. */
export const viewPropsOf = (fields: Partial<OverviewViewProps> = {}): OverviewViewProps => ({
  reads: readsOf(),
  context: CONTEXT,
  networkName: 'Sepolia',
  timeZone: 'UTC',
  ending: undefined,
  methodNameOf: () => 'Guardian',
  adminOf: () => undefined,
  banner: React.createElement('div', { 'data-testid': 'banner-slot' }),
  step: null,
  onOpen: jest.fn(),
  navigate: jest.fn(),
  ...fields
})

/** The ready state of the client hook over a built client. */
export const readyOver = (client: RecoveryKitClient): ClientState =>
  ({ status: 'ready', client, reads: {}, receipts: {}, retry: () => {} } as unknown as ClientState)

/** A setup committed on the stand-in's chain at a privacy level, and a client and records over it. */
export const worldAt = async (level: PrivacyLevel): Promise<World> => {
  sdkStandIn.reset()
  const chain = sdkStandIn.chainFor(descriptorOf(WALLET_RECOVERY_CHAIN, ADDRESS_BOOK), ACCOUNT)
  chain.commitSetup({
    level,
    configuration: CONFIGURATION,
    password: level === 'public' ? undefined : PASSWORD
  })
  chain.setAuthorized(true)
  const client = await buildRecoveryClient({
    chain: WALLET_RECOVERY_CHAIN,
    account: ACCOUNT,
    addressBook: ADDRESS_BOOK,
    provider: sdkStandIn.providerFor(chain),
    codeRead: { code: async () => '0x' },
    transactionRead: async () => null
  })
  const storage: RecordStorage = makeStorage()
  return { chain, client, records: createWalletRecords({ storage }) }
}

/** The view over the overview's own reads, for one client state. */
export const ReadsProbe = ({ client, records, chainId, onOpen }: ReadsProbeProps) => {
  const reads = useOverviewReads({ client, records, chainId, account: ACCOUNT })
  return React.createElement(OverviewView, viewPropsOf({ reads, onOpen }))
}
