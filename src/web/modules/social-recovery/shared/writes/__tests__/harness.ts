/**
 * The tester's one seam onto the writes lane of PT-039 (brief
 * docs/social-recovery/briefs/PT-039.md "Test expectations"). Every test file
 * reaches the lane through this file, so a rename in the lane changes this
 * file alone. The helpers below forward to the lane and decide nothing: the
 * reading, the step and every string come from the lane and from en.json.
 *
 * Mocks, and why:
 * - The provider reads (`ChainReads` of PT-038: the native balance, the gas
 *   estimate and the gas price) are `jest.fn` members. The gas check reads
 *   the chain through them alone, so a test sets the balance and the estimate
 *   and records the transaction the estimate was asked for. No test reaches a
 *   network, and none imports the SDK doubles (the ESLint fence).
 * - Nothing else is mocked. The strings come from the real en.json through
 *   the app's own i18next instance (the renderers' default `t`).
 */
import en from '@common/config/localization/translations/en.json'
import type {
  Address,
  Hex,
  KitError,
  KitErrorName,
  PreparedBatch,
  PreparedCall
} from '@web/modules/social-recovery/sdk-interfaces'
import type {
  ChainReads,
  GasEstimateCall,
  KeyHandle
} from '@web/modules/social-recovery/shared/client'
import * as writes from '@web/modules/social-recovery/shared/writes'
import {
  AttemptAfterCancel,
  checkGas,
  classifyFailure,
  DepositStep,
  GasCheck,
  initialWriteState,
  renderDepositStep,
  renderWriteState,
  settleReceipt,
  WRITE_KINDS,
  WriteKind,
  writeFailureOf,
  writeReducer,
  WriteState
} from '@web/modules/social-recovery/shared/writes'

export * from '@web/modules/social-recovery/shared/writes'
export { writes as LANE }

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The writes the task file names as the consumers of the shared states: the
 * setup save, the submission, the execution and the owner's cancel.
 */
export const CHAPTER_WRITES: WriteKind[] = ['save', 'submission', 'execution', 'cancel']

/** The sending key: the ordinary key of the seed entry on the fast track (D-303). */
export const KEY: KeyHandle = {
  addr: '0x6c482af19b7d03e5c1a684fb27d05e93a8c410b7',
  type: 'internal'
}
/** Another key, so a test proves the step names the key it was given. */
export const OTHER_KEY: KeyHandle = {
  addr: '0x2b0f5e98ee98adc9865745e98802f333f72f6ef5',
  type: 'internal'
}
/** The account's controller as it now stands after a cancel that reverted (D-307). */
export const CONTROLLER: Address = '0x7a19c0dec0dec0dec0dec0dec0dec0dec0dec204'
/** The smart account the key operates, which the transfer route draws from. */
export const ACCOUNT: Address = '0x1111111111111111111111111111111111111111'
export const ACCOUNT_REF = { address: ACCOUNT, name: 'Account 1' }
export const MANAGER: Address = '0x5fbdb2315678afecb367f032d93f642f64180aa3'
export const ACTION: Address = '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512'
export const TX_HASH: Hex = '0x9c1b2e6a0d4f3e8b7a6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a'
export const BLOCK = { number: 7_000_000, hash: TX_HASH }

/** The network record the extension holds for the one chain the wallet reads (D-312). */
export const NETWORK = { name: 'Sepolia', nativeAssetSymbol: 'ETH' }

export const GWEI = 1_000_000_000n

/** The submission, a call anyone may send (sdk.md D-202). */
export const SUBMISSION: PreparedCall = {
  kind: 'call',
  target: MANAGER,
  value: 0n,
  data: '0x1a2b3c4d000000000000000000000000000000000000000000000000000000000000002a',
  sender: 'anyone',
  block: BLOCK
}

/** The execution, another call anyone may send, with other calldata and another target. */
export const EXECUTION: PreparedCall = {
  kind: 'call',
  target: ACTION,
  value: 0n,
  data: '0x5e6f7a8b0000000000000000000000000000000000000000000000000000000000000063',
  sender: 'anyone',
  block: BLOCK
}

/** The owner's cancel, a call whose sender is the account (ux-interfaces.md D-370). */
export const CANCEL: PreparedCall = {
  kind: 'call',
  target: MANAGER,
  value: 0n,
  data: '0x9e2a4b1c',
  sender: 'account',
  block: BLOCK
}

/** A setup write the account signs to itself: one batch (D-319). */
export const SAVE: PreparedBatch = {
  kind: 'batch',
  calls: [
    { ...CANCEL, target: ACCOUNT, data: '0xaaaa0001' },
    { ...CANCEL, target: MANAGER, data: '0xbbbb0002' }
  ],
  atomic: true,
  block: BLOCK
}

/**
 * The transaction the key sends for a write the account runs: the account's
 * own execute, which the account library builds. Its calldata names the write
 * so each write has its own transaction to estimate.
 */
export const ownerTransaction = (write: WriteKind, from: Address = KEY.addr): GasEstimateCall => ({
  from,
  to: ACCOUNT,
  data: `0x51945447${Buffer.from(write).toString('hex')}` as Hex
})

/** The prepared write of each kind. */
export const preparedFor = (write: WriteKind): PreparedCall | PreparedBatch => {
  switch (write) {
    case 'submission':
      return SUBMISSION
    case 'execution':
      return EXECUTION
    case 'cancel':
      return CANCEL
    default:
      return SAVE
  }
}

/** A kit error the wallet decoded for a revert (sdk.md D-205). */
export const kitError = (name: KitErrorName): KitError => ({
  kind: 'known',
  source: 'manager',
  name,
  selector: '0x12345678',
  args: {}
})

// ---------------------------------------------------------------------------
// The provider reads, mocked
// ---------------------------------------------------------------------------

export type MockReads = ChainReads & {
  nativeBalance: jest.Mock
  estimateGas: jest.Mock
  gasPrice: jest.Mock
}

/**
 * The provider reads of PT-038 as `jest.fn` members. `gas` answers each
 * estimate, as a constant or per transaction; every call is recorded.
 */
export const mockReads = ({
  balance,
  gas,
  price = 2n * GWEI
}: {
  balance: bigint
  gas: bigint | ((call: GasEstimateCall) => bigint)
  price?: bigint
}): MockReads => ({
  nativeBalance: jest.fn(async () => balance),
  estimateGas: jest.fn(async (call: GasEstimateCall) =>
    typeof gas === 'function' ? gas(call) : gas
  ),
  gasPrice: jest.fn(async () => price)
})

/** Runs the lane's gas check for a write, off the fast track unless asked. */
export const runGasCheck = (args: {
  write: WriteKind
  reads: ChainReads
  key?: KeyHandle
  fastTrack?: boolean
  prepared?: PreparedCall | PreparedBatch
}): Promise<GasCheck> => {
  const key = args.key ?? KEY
  const prepared = args.prepared ?? preparedFor(args.write)
  const ownerWrite = prepared.kind === 'batch' || prepared.sender === 'account'
  return checkGas({
    write: args.write,
    prepared,
    key,
    reads: args.reads,
    network: NETWORK,
    ...(ownerWrite ? { transaction: ownerTransaction(args.write, key.addr) } : {}),
    ...(args.fastTrack ? { fastTrack: true } : { operates: ACCOUNT_REF })
  })
}

/** The deposit step of a check that came up short; throws where the key held enough. */
export const stepOf = (check: GasCheck): DepositStep => {
  if (check.kind !== 'deposit') throw new Error(`Expected the deposit step, got ${check.kind}`)
  return check.step
}

/** The state the write machine moves to when the check answers. */
export const stateAfterGasCheck = (check: GasCheck): WriteState => {
  const write = check.kind === 'enough' ? check.write : check.step.write
  const checking = writeReducer(initialWriteState(write), { type: 'start' })
  return writeReducer(checking, { type: 'gasChecked', check })
}

/** Every variant of the deposit step: each owner write, and each recovery call on both routes. */
export const STEP_CASES: { name: string; write: WriteKind; fastTrack: boolean }[] = [
  ...WRITE_KINDS.map((write) => ({ name: `${write}`, write, fastTrack: false })),
  { name: 'submission on the fast track', write: 'submission', fastTrack: true },
  { name: 'execution on the fast track', write: 'execution', fastTrack: true }
]

/** A deposit step over a key at zero. */
export const depositStepFor = async (
  write: WriteKind,
  fastTrack: boolean,
  gas = 240_000n,
  price = 2n * GWEI
): Promise<DepositStep> =>
  stepOf(await runGasCheck({ write, fastTrack, reads: mockReads({ balance: 0n, gas, price }) }))

// ---------------------------------------------------------------------------
// The two readings, through the lane
// ---------------------------------------------------------------------------

/** A write that failed with an error before any hash: the lane's classification of it. */
export const failBeforeHash = (write: WriteKind, error: unknown) =>
  classifyFailure(writeFailureOf(error), { write })

/** A thrown value classified by the lane, with the attempt read of a cancel where given. */
export const failThrown = (write: WriteKind, error: unknown, attemptAfter?: AttemptAfterCancel) =>
  classifyFailure(writeFailureOf(error), { write, ...(attemptAfter ? { attemptAfter } : {}) })

/** A receipt with status zero, settled by the lane with the cause the wallet decoded. */
export const failWithReceipt = (
  write: WriteKind,
  cause?: KitError,
  attemptAfter?: AttemptAfterCancel
) =>
  settleReceipt(
    {
      transactionHash: TX_HASH,
      status: 0,
      blockNumber: 7_000_001,
      gasUsed: 51_234n,
      effectiveGasPrice: 2n * GWEI
    },
    { write, ...(attemptAfter ? { attemptAfter } : {}) },
    cause
  )

/** A receipt with status one, settled by the lane. */
export const landWithReceipt = (write: WriteKind) =>
  settleReceipt({ transactionHash: TX_HASH, status: 1 }, { write })

/** The submitting state a write enters once the check answers enough, through the machine. */
export const submittingFor = (write: WriteKind): WriteState =>
  writeReducer(writeReducer(initialWriteState(write), { type: 'start' }), {
    type: 'gasChecked',
    check: {
      kind: 'enough',
      write,
      key: KEY.addr,
      estimate: { gas: 1n, gasPrice: 1n, cost: 1n, required: 1n },
      balance: 1n
    }
  })

/** Which reading a state is. */
export const readingOf = (state: WriteState): 'notSent' | 'reverted' | 'landed' | string =>
  state.status === 'failedNotSent'
    ? 'notSent'
    : state.status === 'failedReverted'
    ? 'reverted'
    : state.status

// ---------------------------------------------------------------------------
// The copy a view lays out
// ---------------------------------------------------------------------------

type Translate = (key: string, options?: Record<string, unknown>) => string

/** Every string `WriteStateView` shows for a state: the chip, the title, the lines, the controller and the retry. */
export const copyOfState = (state: WriteState, t?: Translate): string[] => {
  const r = t ? renderWriteState(state, t) : renderWriteState(state)
  return [r.chip, r.title, ...r.lines, r.controller?.label, r.controller?.address, r.retry].filter(
    (s): s is string => typeof s === 'string'
  )
}

/** Every string `DepositStepView` shows for the whole step. */
export const copyOfStep = (step: DepositStep, t?: Translate): string[] => {
  const r = t ? renderDepositStep(step, {}, t) : renderDepositStep(step)
  return [
    r.eyebrow,
    r.title,
    ...r.lead,
    r.keyLabel,
    r.keyAddress,
    r.copyLabel,
    ...r.routes.flatMap((route) => [route.line, route.note]),
    ...r.notes,
    ...r.waiting,
    r.actionHint
  ].filter((s): s is string => typeof s === 'string')
}

/** Every string `DepositStepView` shows for the blocker that leads to the step. */
export const copyOfBlocker = (step: DepositStep): string[] => {
  const r = renderDepositStep(step)
  return [r.blocker.title, r.blocker.line, r.keyLabel, r.keyAddress, r.copyLabel].filter(
    (s): s is string => typeof s === 'string'
  )
}

export const text = (strings: string[]): string => strings.join('\n')

// ---------------------------------------------------------------------------
// Errors a send can end in
// ---------------------------------------------------------------------------

/** The holder rejected the request in the signing prompt: ethers' ACTION_REJECTED, no hash. */
export const userRejected = (): Error =>
  Object.assign(new Error('user rejected action'), { code: 'ACTION_REJECTED' })

/** The node refused the transaction before it took it: no hash. */
export const nodeRefused = (): Error =>
  Object.assign(new Error('insufficient funds for intrinsic transaction cost'), {
    code: 'INSUFFICIENT_FUNDS'
  })

/** A plain failure of the wallet before anything was broadcast. */
export const walletFailed = (): Error => new Error('The signer is not reachable')

/**
 * ethers' error from `wait()` on a transaction the chain mined and reverted:
 * a CALL_EXCEPTION carrying the hash and the receipt with status zero.
 */
export const minedAndReverted = (hash: Hex = TX_HASH): Error =>
  Object.assign(new Error('transaction execution reverted'), {
    code: 'CALL_EXCEPTION',
    action: 'sendTransaction',
    receipt: { hash, status: 0, blockNumber: 7_000_001, gasUsed: 51_234n },
    transaction: { hash }
  })

/** A wait that timed out after the broadcast: the hash is known, no receipt came back. */
export const waitTimedOut = (hash: Hex = TX_HASH): Error =>
  Object.assign(new Error('timeout'), { code: 'TIMEOUT', transaction: { hash } })

// ---------------------------------------------------------------------------
// Strings
// ---------------------------------------------------------------------------

/** Every string reachable from a value, depth first. */
export const collectStrings = (
  value: unknown,
  out: string[] = [],
  seen = new Set<unknown>()
): string[] => {
  if (typeof value === 'string') out.push(value)
  else if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value)
    Object.values(value as Record<string, unknown>).forEach((v) => collectStrings(v, out, seen))
  }
  return out
}

/** The banned words of ux-copy.md, UXC-1 to UXC-7 and UXC-9, as the copy lint reads them. */
export const BANS: { rule: string; pattern: RegExp }[] = [
  { rule: 'UXC-1 policy', pattern: /\bpolic(?:y|ies)\b/i },
  { rule: 'UXC-2 proof', pattern: /\bproofs?\b/i },
  { rule: 'UXC-3 relayer', pattern: /\brelayers?\b/i },
  { rule: 'UXC-4 EIP-712', pattern: /\bEIP[-\s]?712\b/i },
  { rule: 'UXC-5 atomic', pattern: /\batomic(?:ally)?\b/i },
  { rule: 'UXC-6 Protected', pattern: /\bProtected\b/ },
  { rule: 'UXC-6 protect (reviewer reading)', pattern: /\b(?:un)?protect/i },
  { rule: 'UXC-7 your people', pattern: /\byour\s+people\b/i },
  { rule: 'UXC-9 full wallet password', pattern: /\bfull\s+wallet\s+passwords?\b/i }
]

export const banHits = (strings: string[]): string[] =>
  strings.flatMap((s) =>
    BANS.filter(({ pattern }) => pattern.test(s)).map(({ rule }) => `${rule}: ${s}`)
  )

/** A string that promises one funding covers the submission and the execution (D-303). */
export const ONE_FUNDING_COVERS_BOTH =
  /\b(?:covers?|pays? for|enough for|funds?|lasts? for)\s+(?:them\s+)?both\b|\bone funding\b|\bsingle funding\b|\bboth (?:the )?(?:transactions|steps|fundings|the submission and the execution)\b|\bonly (?:fund|once)\b|\bfund (?:it|this key) once\b/i

/** A rendered string that is a raw key or an unfilled placeholder: a string en.json does not hold. */
export const UNRESOLVED = /\bsocialRecovery\.[\w.]+|\{\{\w+\}\}/

// Jest runs every file under __tests__, this one included; its own check runs
// only when Jest runs this file, never from a file that imports the harness.
if (expect.getState().testPath === __filename) {
  describe('harness', () => {
    it('mocks the provider reads and records each estimate', async () => {
      const reads = mockReads({ balance: 5n, gas: (call) => BigInt(call.data.length) })
      expect(await reads.nativeBalance(KEY.addr)).toBe(5n)
      expect(await reads.estimateGas({ from: KEY.addr, to: MANAGER, data: '0x00' })).toBe(4n)
      expect(reads.estimateGas).toHaveBeenCalledWith({ from: KEY.addr, to: MANAGER, data: '0x00' })
    })

    it('reads the copy regexes against the real en.json writes block', () => {
      const strings = collectStrings(en.socialRecovery.writes)
      expect(strings.length).toBeGreaterThan(10)
      expect(banHits(strings)).toEqual([])
      expect(strings.filter((s) => ONE_FUNDING_COVERS_BOTH.test(s))).toEqual([])
      expect(UNRESOLVED.test('socialRecovery.writes.causes.unnamed')).toBe(true)
      expect(UNRESOLVED.test('Send on Sepolia, the network.')).toBe(false)
    })

    it('gives each write its own prepared call and its own transaction', () => {
      const data = WRITE_KINDS.map((write) => ownerTransaction(write).data)
      expect(new Set(data).size).toBe(WRITE_KINDS.length)
      expect(preparedFor('submission')).toBe(SUBMISSION)
      expect(preparedFor('cancel')).toBe(CANCEL)
    })
  })
}
