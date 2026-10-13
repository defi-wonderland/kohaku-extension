/**
 * @jest-environment jsdom
 *
 * Mounts the approval page with the app's own components and the real
 * en.json. The edges are fakes: the router's search, the window's hash, the
 * wallet's networks, keystore, accounts and navigation, the request queue's
 * signer facade, the clipboard, the file save, the QR code, and the recovery
 * client the page builds for the request's account, whose description, chain
 * reads and approving side each test scripts. The approving side's default
 * script is the wallet method's: it hands over the request's typed data,
 * packages a signature as the reply's proof and judges it by the address it
 * recovers to. The guardian's key is a throwaway key that signs in the test.
 * The logo is a stub. jsdom has no `TextEncoder`, which viem reads when it
 * loads, so the harness sets Node's before it loads the modules.
 */
import { createRoot, Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { TextDecoder, TextEncoder } from 'util'

import type { ThemeContextReturnType } from '@common/contexts/themeContext'
import type { ThemeProps } from '@common/styles/themeConfig'
import type {
  Address,
  ApproverReply,
  ApproverRequest,
  Attempt,
  Hex,
  RecoveryState,
  ReplyFailure,
  RequestDescription,
  Verdict
} from '@web/modules/social-recovery/sdk-interfaces'
import type {
  KeyHandle,
  SignFlowFailureReason,
  TypedDataToSign
} from '@web/modules/social-recovery/shared/client'
import type { RecoveryClientState } from '@web/modules/social-recovery/shared/client/useRecoveryClient'

Object.assign(globalThis, { TextEncoder, TextDecoder })
// React only runs effects and state updates inside act() when this flag is set.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ---------------------------------------------------------------------------
// Test-only types
// ---------------------------------------------------------------------------

/** The client state the page's hook hands back, with its retry. */
export type ClientState = RecoveryClientState & { retry: () => void }

/** The request account's scripted client: its description, its two chain reads and its approving side. */
export interface KitScript {
  describeRequest: jest.Mock<RequestDescription, [ApproverRequest]>
  recoveryState: jest.Mock<Promise<RecoveryState>, []>
  isAuthorized: jest.Mock<Promise<boolean>, []>
  signingInput: jest.Mock<unknown, [ApproverRequest]>
  replyFrom: jest.Mock<Promise<ApproverReply | ReplyFailure>, [ApproverRequest, unknown, unknown]>
  verify: jest.Mock<Promise<Verdict>, [ApproverRequest, number, Hex]>
}

/** The keystore as the page reads it. */
export interface KeystoreScript {
  keys: { addr: string; type: 'internal' }[]
  isUnlocked: boolean
  hasPasswordSecret: boolean
}

/** A file the page saved. */
export interface SavedFile {
  name: string
  text: string
  type: string
}

/** The wallet's edges the signing half reads. */
export interface WalletScript {
  keystore: KeystoreScript
  navigate: jest.Mock<void, [string]>
  signTypedData: jest.Mock<Promise<Hex>, [KeyHandle, TypedDataToSign]>
  copied: jest.Mock<Promise<boolean>, [string]>
  saved: jest.Mock<void, [SavedFile]>
  qr: string[]
}

export interface Mounted {
  unmount: () => void
  has: (id: string) => boolean
  textOf: (id: string) => string
  text: () => string
  press: (id: string) => Promise<void>
  isDisabled: (id: string) => boolean
  /** Types text into the input under a test id. */
  type: (id: string, text: string) => Promise<void>
}

// ---------------------------------------------------------------------------
// The edges
// ---------------------------------------------------------------------------

const mockLocation: { search: string } = { search: '' }
const mockClient: {
  state: ClientState | null
  accounts: (string | undefined)[]
  listeners: Set<() => void>
} = { state: null, accounts: [], listeners: new Set() }
const mockLoading: ClientState = { status: 'loading', retry: () => {} }
const mockWallet: WalletScript = {
  keystore: { keys: [], isUnlocked: true, hasPasswordSecret: true },
  navigate: jest.fn(),
  signTypedData: jest.fn(),
  copied: jest.fn(),
  saved: jest.fn(),
  qr: []
}

jest.mock('@web/modules/social-recovery/shared/client/useRecoveryClient', () => ({
  useRecoveryClient: (account: string | undefined) => {
    mockClient.accounts.push(account)
    // eslint-disable-next-line global-require
    return require('react').useSyncExternalStore(
      (listener: () => void) => {
        mockClient.listeners.add(listener)
        return () => mockClient.listeners.delete(listener)
      },
      () => (account ? mockClient.state ?? mockLoading : mockLoading)
    )
  }
}))
jest.mock('@web/hooks/useNetworksControllerState', () => ({
  __esModule: true,
  default: () => ({ networks: [] })
}))
jest.mock('@web/hooks/useKeystoreControllerState', () => ({
  __esModule: true,
  default: () => mockWallet.keystore
}))
jest.mock('@web/hooks/useAccountsControllerState', () => ({
  __esModule: true,
  default: () => ({ accounts: [] })
}))
jest.mock('@web/hooks/useBackgroundService', () => {
  const dispatch = () => undefined
  return { __esModule: true, default: () => ({ dispatch, windowId: undefined }) }
})
jest.mock('@common/hooks/useNavigation', () => {
  const navigate = (to: string) => mockWallet.navigate(to)
  return { __esModule: true, default: () => ({ navigate }) }
})
jest.mock('@web/modules/social-recovery/shared/client', () => ({
  ...jest.requireActual('@web/modules/social-recovery/shared/client'),
  createSignerFacade: () => ({
    signTypedData: (key: KeyHandle, typedData: TypedDataToSign) =>
      mockWallet.signTypedData(key, typedData),
    signBytes: () => Promise.reject(new Error('no bytes are signed here'))
  })
}))
jest.mock('@common/utils/clipboard', () => ({
  setStringAsync: (text: string) => mockWallet.copied(text)
}))
jest.mock('@web/modules/social-recovery/setup/enroll/carriers', () => ({
  saveChallengeFile: (file: SavedFile) => mockWallet.saved(file)
}))
// The QR library ships untranspiled modules.
jest.mock('react-native-qrcode-svg', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => {
    mockWallet.qr.push(value)
    return null
  }
}))
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useLocation: () => ({ pathname: '/social-recovery/approve', search: mockLocation.search })
}))
jest.mock('@common/components/AmbireLogoHorizontal', () => ({
  __esModule: true,
  default: () => null
}))
// The page's deployment is the build's own; no deployment variable from a
// developer's environment changes it.
jest.mock('@web/modules/social-recovery/shared/client/deployment-env', () => ({
  SEPOLIA_DEPLOYMENT_VARIABLE: 'SOCIAL_RECOVERY_SEPOLIA_DEPLOYMENT',
  sepoliaDeploymentVariable: () => undefined
}))

/* eslint-disable @typescript-eslint/no-var-requires, global-require */
const React: typeof import('react') = require('react')
const {
  decodeAbiParameters,
  encodeAbiParameters,
  getAddress,
  hashTypedData,
  isAddressEqual,
  keccak256,
  recoverTypedDataAddress,
  zeroAddress
}: typeof import('viem') = require('viem')
const {
  generatePrivateKey,
  privateKeyToAccount
}: typeof import('viem/accounts') = require('viem/accounts')
const {
  ThemeContext
}: typeof import('@common/contexts/themeContext') = require('@common/contexts/themeContext')
const themeConfig: typeof import('@common/styles/themeConfig') = require('@common/styles/themeConfig')
const i18n: typeof import('@common/config/localization').default =
  require('@common/config/localization').default
const {
  WEB_ROUTES
}: typeof import('@common/modules/router/constants/common') = require('@common/modules/router/constants/common')
const {
  addressBookOf,
  descriptorOf,
  signFlowFailure,
  WALLET_RECOVERY_CHAIN
}: typeof import('@web/modules/social-recovery/shared/client') = require('@web/modules/social-recovery/shared/client')
const {
  renderApproval
}: typeof import('@web/modules/social-recovery/shared/display') = require('@web/modules/social-recovery/shared/display')
const {
  digestOfRequest,
  membersOfRequest,
  typedDataOf
}: typeof import('@web/modules/social-recovery/sdk-doubles/encoding') = require('@web/modules/social-recovery/sdk-doubles/encoding')
const {
  approvalLinkOf,
  replyLineOf
}: typeof import('@web/modules/social-recovery/recovery/checklist') = require('@web/modules/social-recovery/recovery/checklist')
const ApproveScreen: typeof import('@web/modules/social-recovery/guardian-page/ApproveScreen').default =
  require('@web/modules/social-recovery/guardian-page/ApproveScreen').default
/* eslint-enable @typescript-eslint/no-var-requires, global-require */

export const t = (key: string, values?: Record<string, unknown>): string => i18n.t(key, values)

export const DESCRIPTOR = descriptorOf(WALLET_RECOVERY_CHAIN, addressBookOf(WALLET_RECOVERY_CHAIN))
/** The manager the build reads, checksummed as the page draws it. */
export const MANAGER: Address = getAddress(DESCRIPTOR.manager)

/** The account being recovered. */
export const ACCOUNT: Address = getAddress('0x2b0f5e98ee98adc9865745e98802f333f72f6ef5')
/** The key the recovery installs. */
export const NEW_KEY: Address = getAddress('0x7a19c3f0b41d8e5a90cc77b2e4f8135aa62cc204')
/** The key the recovery removes. */
export const REMOVED_KEY: Address = getAddress('0x3fb2c4e8a19d07f6e5c3d1b8a24f9e7c60d1a2a2')
/** A payee the payment order names. */
export const PAYEE: Address = getAddress('0x9a4d000000000000000000000000000000000011')

/** The guardian's throwaway key, the one the request names. */
export const GUARDIAN_ACCOUNT = privateKeyToAccount(generatePrivateKey())
export const GUARDIAN: Address = GUARDIAN_ACCOUNT.address
/** Another throwaway key, one the request does not name. */
export const STRANGER_ACCOUNT = privateKeyToAccount(generatePrivateKey())

/** A credential config naming an address, as the wallet method encodes it. */
export const configOf = (address: Address): Hex =>
  encodeAbiParameters([{ type: 'address' }], [address])

/** The request's moment of creation and its deadline, 24 hours later, in seconds. */
export const CREATED_AT = 1_800_000_000
export const VALID_UNTIL = CREATED_AT + 86_400

export const PAYLOAD: Hex = '0xabcdef'
export const ATTEMPT_ID = '3'
export const SETUP_NONCE = '2'

/** The approval request one place's link carries. */
export const requestOf = (overrides: Partial<ApproverRequest> = {}): ApproverRequest => ({
  kind: 'recovery-proof-request',
  version: 1,
  purpose: 'approval',
  chainId: String(DESCRIPTOR.chainId),
  manager: DESCRIPTOR.manager,
  digestVersion: DESCRIPTOR.digestVersion,
  account: ACCOUNT,
  action: DESCRIPTOR.action,
  attemptId: ATTEMPT_ID,
  setupNonce: SETUP_NONCE,
  setupBodyHash: `0x${'5e'.repeat(32)}`,
  payload: PAYLOAD,
  validUntil: String(VALID_UNTIL),
  place: 1,
  method: DESCRIPTOR.methodEcdsa,
  config: configOf(GUARDIAN),
  salt: '0x02',
  ...overrides
})

/** The extension's full-tab page a link opens. */
export const TAB_URL = 'chrome-extension://kohaku/tab.html'

/** The link to the approval page for a request. */
export const linkOf = (request: ApproverRequest) => approvalLinkOf(request, TAB_URL)

/** The search string the router hands the page for a link. */
export const searchOf = (link: string) => link.slice(link.indexOf('?'))

/** What the orchestrator describes of a request: its values, with the handover decoded. */
export const descriptionOf = (
  request: ApproverRequest,
  overrides: Partial<RequestDescription> = {}
): RequestDescription => ({
  account: request.account,
  chainId: BigInt(request.chainId),
  manager: request.manager,
  action: request.action,
  attemptId: BigInt(request.attemptId),
  setupNonce: BigInt(request.setupNonce),
  purpose: 'approval',
  handover: {
    decoded: true,
    value: { newAuthority: NEW_KEY, removedAuthority: REMOVED_KEY }
  },
  validUntil: Number(request.validUntil),
  place: request.place,
  identityPublic: undefined,
  device: undefined,
  ...overrides
})

/** The manager's empty attempt slot. */
export const NO_ATTEMPT: Attempt = {
  state: 'None',
  attemptId: 0n,
  setupNonce: 0n,
  consumableAfter: 0,
  payloadHash: `0x${'00'.repeat(32)}`,
  order: { token: zeroAddress, amount: 0n, payee: zeroAddress },
  usedMethods: [],
  ignoresPause: false
}

/** The end of the submitted attempt's waiting period, in seconds. */
export const WAIT_ENDS_AT = CREATED_AT + 3 * 86_400

/** The recoverer's submission of the request, waiting out its period. */
export const SUBMITTED: Attempt = {
  ...NO_ATTEMPT,
  state: 'Waiting',
  attemptId: BigInt(ATTEMPT_ID),
  setupNonce: BigInt(SETUP_NONCE),
  consumableAfter: WAIT_ENDS_AT,
  payloadHash: keccak256(PAYLOAD)
}

/** The account's recovery state while the request is live. */
export const recoveryStateOf = (overrides: Partial<RecoveryState> = {}): RecoveryState => ({
  attempt: NO_ATTEMPT,
  nextAttemptId: BigInt(ATTEMPT_ID),
  setupCommitment: `0x${'ab'.repeat(32)}`,
  setupNonce: BigInt(SETUP_NONCE),
  removedKey: REMOVED_KEY,
  block: { number: 200, timestamp: CREATED_AT, hash: `0x${'cd'.repeat(32)}` },
  ...overrides
})

/** The typed data the wallet method hands over for a request. */
export const typedDataFor = (request: ApproverRequest): TypedDataToSign =>
  typedDataOf(membersOfRequest(request)) as unknown as TypedDataToSign

type SigningAccount = typeof GUARDIAN_ACCOUNT

/** A signature by a throwaway key over typed data. */
export const signatureBy = (account: SigningAccount, typedData: TypedDataToSign): Promise<Hex> =>
  account.signTypedData(typedData as unknown as Parameters<SigningAccount['signTypedData']>[0])

/** The reply the wallet method packages from a signature: the signature is the proof. */
export const replyOf = (request: ApproverRequest, proof: Hex): ApproverReply => ({
  kind: 'recovery-proof-reply',
  version: 1,
  chainId: request.chainId,
  manager: request.manager,
  account: request.account,
  action: request.action,
  attemptId: request.attemptId,
  purpose: request.purpose,
  place: request.place,
  method: request.method,
  config: request.config,
  salt: request.salt,
  digest: digestOfRequest(request),
  proof
})

/** The line the guardian sends back for a reply. */
export const lineOf = (reply: ApproverReply): string => replyLineOf(reply)

/** The EIP-712 digest of typed data. */
export const hashOf = (typedData: TypedDataToSign): Hex =>
  hashTypedData(typedData as unknown as Parameters<typeof hashTypedData>[0])

/** An approval as the signed page shows it. */
export const approvalOf = (proof: Hex): string => renderApproval(proof)

/** The signer facade's refusal for a reason. */
export const signRefusal = (reason: SignFlowFailureReason) =>
  signFlowFailure('signTypedData', reason)

/** Where the page sends a locked wallet. */
export const UNLOCK_ROUTE = WEB_ROUTES.keyStoreUnlock

/** The wallet method's verdict: satisfied where the signature recovers to the address the config names. */
const walletVerdict = async (request: ApproverRequest, proof: Hex): Promise<Verdict> => {
  try {
    const [named] = decodeAbiParameters([{ type: 'address' }], request.config)
    const signer = await recoverTypedDataAddress({
      ...(typedDataFor(request) as unknown as Parameters<typeof recoverTypedDataAddress>[0]),
      signature: proof
    })
    return isAddressEqual(signer, named) ? 'satisfied' : 'rejected'
  } catch {
    return 'rejected'
  }
}

/** The wallet method the client's registry hands out under its slug. */
const walletMethod = {
  modules: () => [DESCRIPTOR.methodEcdsa],
  codec: {
    decodeConfig: (config: Hex) => {
      const [address] = decodeAbiParameters([{ type: 'address' }], config)
      return { address }
    }
  }
}

export const kit: KitScript = {
  describeRequest: jest.fn(),
  recoveryState: jest.fn(),
  isAuthorized: jest.fn(),
  signingInput: jest.fn(),
  replyFrom: jest.fn(),
  verify: jest.fn()
}

/** The wallet's edges each test scripts. */
export const wallet = mockWallet

/** The ready state of the page's hook over the scripted client. */
export const readyClient = (descriptor = DESCRIPTOR): ClientState =>
  ({
    status: 'ready',
    client: {
      descriptor,
      approving: {
        describeRequest: (request: ApproverRequest) => kit.describeRequest(request),
        signingInput: (request: ApproverRequest) => kit.signingInput(request),
        replyFrom: (request: ApproverRequest, input: unknown, material: unknown) =>
          kit.replyFrom(request, input, material),
        verify: (request: ApproverRequest, place: number, proof: Hex) =>
          kit.verify(request, place, proof)
      },
      methodFor: (slug: string) => (slug === 'ecdsa' ? walletMethod : undefined),
      recovery: { recoveryState: () => kit.recoveryState() },
      action: { isAuthorized: () => kit.isAuthorized() }
    },
    reads: {},
    receipts: {},
    retry: () => {}
  } as unknown as ClientState)

/** Sets the client state the page gets, and renders it. */
export const setClient = (state: ClientState | null) => {
  act(() => {
    mockClient.state = state
    mockClient.listeners.forEach((listener) => listener())
  })
}

/** The accounts the page asked a client for, in order, undefined where it asked for none. */
export const clientAccounts = () => mockClient.accounts

/** The search string the router hands the page. */
export const setSearch = (search: string) => {
  mockLocation.search = search
}

/** A signature that has the shape of hex bytes. */
const hexBytes = (value: unknown): value is Hex =>
  typeof value === 'string' && /^0x([0-9a-fA-F]{2})+$/.test(value)

/**
 * Puts every edge back: the page's clock at the request's creation, a live
 * request on chain, the wallet method's approving side, and an unlocked
 * wallet that holds the guardian's key.
 */
export const resetEdges = () => {
  jest.useFakeTimers('modern')
  jest.setSystemTime(CREATED_AT * 1000)
  window.location.hash = ''
  mockLocation.search = ''
  mockClient.accounts = []
  mockClient.state = readyClient()
  kit.describeRequest.mockReset()
  kit.describeRequest.mockImplementation((request) => descriptionOf(request))
  kit.recoveryState.mockReset()
  kit.recoveryState.mockImplementation(async () => recoveryStateOf())
  kit.isAuthorized.mockReset()
  kit.isAuthorized.mockImplementation(async () => true)
  kit.signingInput.mockReset()
  kit.signingInput.mockImplementation((request) => typedDataFor(request))
  kit.replyFrom.mockReset()
  kit.replyFrom.mockImplementation(async (request, _input, material) => {
    const signature = (material as { signature?: unknown } | undefined)?.signature
    return hexBytes(signature)
      ? replyOf(request, signature)
      : { kind: 'reply-failure', cause: 'material-rejected' }
  })
  kit.verify.mockReset()
  kit.verify.mockImplementation((request, _place, proof) => walletVerdict(request, proof))
  mockWallet.keystore = {
    keys: [{ addr: GUARDIAN, type: 'internal' }],
    isUnlocked: true,
    hasPasswordSecret: true
  }
  mockWallet.navigate.mockReset()
  mockWallet.signTypedData.mockReset()
  mockWallet.signTypedData.mockImplementation((_key, typedData) =>
    signatureBy(GUARDIAN_ACCOUNT, typedData)
  )
  mockWallet.copied.mockReset()
  mockWallet.copied.mockImplementation(async () => true)
  mockWallet.saved.mockReset()
  mockWallet.qr = []
}

// ---------------------------------------------------------------------------
// The mount
// ---------------------------------------------------------------------------

const THEME = Object.fromEntries(
  Object.entries(themeConfig.default).map(([name, byType]) => [
    name,
    byType[themeConfig.THEME_TYPES.LIGHT]
  ])
) as ThemeProps

const THEME_CONTEXT: ThemeContextReturnType = {
  theme: THEME,
  themeType: themeConfig.THEME_TYPES.LIGHT,
  selectedThemeType: themeConfig.THEME_TYPES.LIGHT,
  setThemeType: () => {}
}

/** Lets the pending reads settle, then renders what they changed. The fakes answer in microtasks. */
export const settle = () =>
  act(async () => {
    for (let round = 0; round < 10; round += 1) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve()
    }
  })

/** Moves the page's clock and its timers forward, then lets the reads settle. */
export const advance = async (ms: number) => {
  act(() => {
    jest.advanceTimersByTime(ms)
  })
  await settle()
}

/** Mounts the approval page on the search string the router hands it. */
export const mountPage = async (search: string): Promise<Mounted> => {
  setSearch(search)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  const byTestId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`)

  await act(async () => {
    root.render(
      <ThemeContext.Provider value={THEME_CONTEXT}>
        <ApproveScreen />
      </ThemeContext.Provider>
    )
  })
  await settle()

  return {
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
    has: (id) => byTestId(id) !== null,
    textOf: (id) => byTestId(id)?.textContent ?? '',
    text: () => container.textContent ?? '',
    press: async (id) => {
      const node = byTestId(id)
      if (!node) {
        throw new Error(`nothing to press: ${id}`)
      }
      act(() => node.click())
      await settle()
    },
    isDisabled: (id) => byTestId(id)?.getAttribute('aria-disabled') === 'true',
    type: async (id, text) => {
      const node = byTestId(id)
      const input =
        node instanceof HTMLInputElement ? node : node?.querySelector<HTMLInputElement>('input')
      if (!input) {
        throw new Error(`nothing to type into: ${id}`)
      }
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      act(() => {
        setValue?.call(input, text)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await settle()
    }
  }
}

/** Mounts the page on the search string of a request's link. */
export const mountLive = (request: ApproverRequest = requestOf()) =>
  mountPage(searchOf(linkOf(request)))

// Registered only when Jest runs this file itself: a suite that imports the
// harness does not run its checks again.
const runningHarnessItself = expect.getState().testPath === __filename

const describeHarness = runningHarnessItself ? describe : () => undefined

describeHarness('the approval page harness', () => {
  beforeEach(resetEdges)
  afterEach(() => jest.useRealTimers())

  it('hands the page the scripted client for the request account and reads through it', async () => {
    const page = await mountLive()
    expect(clientAccounts()).toContain(ACCOUNT)
    expect(kit.describeRequest).toHaveBeenCalled()
    expect(kit.recoveryState).toHaveBeenCalledTimes(1)
    expect(kit.isAuthorized).toHaveBeenCalledTimes(1)
    page.unmount()
  })

  it('judges a signature by the guardian key as satisfied and one by another key as rejected', async () => {
    const request = requestOf()
    const typedData = typedDataFor(request)
    const own = await signatureBy(GUARDIAN_ACCOUNT, typedData)
    const other = await signatureBy(STRANGER_ACCOUNT, typedData)
    await expect(kit.verify(request, request.place, own)).resolves.toBe('satisfied')
    await expect(kit.verify(request, request.place, other)).resolves.toBe('rejected')
  })
})
