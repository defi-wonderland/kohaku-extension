/**
 * The wallet's records: the six setup records, the recovery session and its
 * five wipe events, the countdown the landed session carries, and the
 * decrypted setup cache.
 *
 * Every test runs against an in-memory double of
 * src/web/extension-services/background/webapi/storage.ts that behaves like it:
 * `set` stores the rich JSON string of a non-string value, and `get` returns the
 * default when the stored string is falsy and parses it otherwise. So a field
 * holding `undefined` loses its key and a `bigint` survives, as in the extension.
 */
import { parse, stringify } from '@ambire-common/libs/richJson/richJson'
import en from '@common/config/localization/translations/en.json'
import type {
  Address,
  ApproverReply,
  Configuration,
  Gathering,
  Hex,
  SetupDraft
} from '@web/modules/social-recovery/sdk-interfaces'
import {
  ABSENT,
  createWalletRecords,
  DecryptedSetupCacheRecord,
  DirectWipeEvent,
  Enrollment,
  predictedAttemptId,
  recordAge,
  RecordRead,
  RecoverySessionRecord,
  RecoveryWipeEvent,
  SETUP_RECORD_NAMES,
  SetupRecordName,
  SetupRecordValues,
  WIPE_REASON_STRING_KEYS
} from '@web/modules/social-recovery/shared/records'

type StorageDouble = {
  get: (key: string, defaultValue?: unknown) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<null>
  remove: (key: string) => Promise<null>
  /** The helper's `get()` with no key: every entry, each value parsed. */
  getAll: () => Promise<Record<string, unknown>>
  /** What `browser.storage.local` would hold: one string per key. */
  raw: Map<string, string>
  /** The keys of every `set` and `remove` call, in order. */
  calls: { set: string[]; remove: string[] }
}

// The helper's `formatValue`: parse a string, or return it as is when it is not JSON.
const formatValue = (stored: string): unknown => {
  try {
    return parse(stored)
  } catch (error) {
    return stored
  }
}

const makeStorage = (): StorageDouble => {
  const raw = new Map<string, string>()
  const calls = { set: [] as string[], remove: [] as string[] }
  return {
    raw,
    calls,
    // The helper's rule: `if (!res[key]) return defaultValue`, then `formatValue`.
    get: async (key, defaultValue) => {
      const stored = raw.get(key)
      if (!stored) return defaultValue
      return formatValue(stored)
    },
    getAll: async () =>
      Object.fromEntries([...raw.entries()].map(([key, stored]) => [key, formatValue(stored)])),
    // The helper's `set`: a string as is, anything else through richJson.
    set: async (key, value) => {
      calls.set.push(key)
      const serialized: string | undefined = typeof value === 'string' ? value : stringify(value)
      // `browser.storage.local.set({ [key]: undefined })` stores nothing.
      if (serialized !== undefined) raw.set(key, serialized)
      return null
    },
    remove: async (key) => {
      calls.remove.push(key)
      raw.delete(key)
      return null
    }
  }
}

// A record the platform keeps for the holder's credentials, which neither save
// nor start over may touch.
const PLATFORM_CREDENTIALS_KEY = 'keystoreKeys'
const PLATFORM_CREDENTIALS = [{ addr: '0xCredential', type: 'internal', label: 'passkey' }]

const ACCOUNT: Address = '0x1111111111111111111111111111111111111111'
const OTHER_ACCOUNT: Address = '0x2222222222222222222222222222222222222222'
const METHOD: Address = '0x3333333333333333333333333333333333333333'
const MANAGER: Address = '0x4444444444444444444444444444444444444444'
const ACTION: Address = '0x5555555555555555555555555555555555555555'
const CHAIN_ID = 11155111n
const T0 = 1_700_000_000_000
const HOUR = 60 * 60 * 1000

const SETUP_DRAFT: SetupDraft = {
  wait: 86400n,
  clauses: [{ threshold: 1, credentials: [{ method: METHOD, config: '0xabcd' }] }],
  ignoresPause: false,
  privacy: { publicMetadata: '0x', backup: 'encrypted' }
}

const ENROLLMENT: Enrollment = {
  credential: { method: METHOD, config: '0xabcd' },
  test: 'passed',
  backup: 'device-bound'
}

const SETUP_SAMPLES: SetupRecordValues = {
  setupDraft: SETUP_DRAFT,
  inventory: ['another-device', 'guardian-wallets'],
  path: SETUP_DRAFT.clauses,
  enrollments: [ENROLLMENT],
  waitingPeriod: 86400n,
  passwordSet: 'password-set'
}

const CONFIGURATION: Configuration = {
  clauses: SETUP_DRAFT.clauses,
  wait: SETUP_DRAFT.wait,
  ignoresPause: false
}
const CACHE: DecryptedSetupCacheRecord = { configuration: CONFIGURATION, setupNonce: 3n }

const PREDICTED_ATTEMPT_ID = 7n
const VALID_UNTIL = '1700086400'
const PROOF_A = '0xdeadbeefdeadbeef'
const PROOF_B = '0xfeedfacefeedface'

const reply = (place: number, proof: Hex, account: Address = ACCOUNT): ApproverReply => ({
  kind: 'recovery-proof-reply',
  version: 1,
  chainId: CHAIN_ID.toString(),
  manager: MANAGER,
  account,
  action: ACTION,
  attemptId: PREDICTED_ATTEMPT_ID.toString(),
  purpose: 'approval',
  place,
  method: METHOD,
  config: '0xabcd',
  salt: '0x01',
  digest: '0x0badc0de',
  proof
})

const APPROVALS: ApproverReply[] = [reply(0, PROOF_A), reply(1, PROOF_B)]

// The SDK's gathering record, the body of a live session.
const gathering = (
  account: Address = ACCOUNT,
  replies: ApproverReply[] = APPROVALS,
  request: Partial<Gathering['request']> = {}
): Gathering => ({
  kind: 'gathering',
  version: 1,
  purpose: 'approval',
  request: {
    chainId: CHAIN_ID.toString(),
    manager: MANAGER,
    digestVersion: '1',
    account,
    action: ACTION,
    attemptId: PREDICTED_ATTEMPT_ID.toString(),
    setupNonce: '3',
    setupBody: '0x00',
    validUntil: VALID_UNTIL,
    block: { number: 1, timestamp: '1700000000', hash: '0x01' },
    ...request
  },
  places: [0, 1].map((place) => ({
    place,
    method: METHOD,
    config: '0xabcd',
    salt: '0x01',
    standing: 'not-stopped',
    stoppable: false
  })),
  replies
})

const GATHERING = gathering()

const FIVE_EVENTS: RecoveryWipeEvent[] = [
  'submission-landed',
  'deadline-passed',
  'another-attempt-opened',
  'setup-changed',
  'recoverer-abandoned'
]
const DIRECT_EVENTS = FIVE_EVENTS.filter((e) => e !== 'submission-landed') as DirectWipeEvent[]

const setup = (clock: { t: number } = { t: T0 }) => {
  const storage = makeStorage()
  const records = createWalletRecords({ storage, now: () => clock.t })
  return { storage, records, clock }
}

type Records = ReturnType<typeof createWalletRecords>

const present = <T>(read: RecordRead<T>) => {
  if (read.status !== 'present') throw new Error('expected a present record')
  return read
}

// Every stored string, keys included, to prove a secret is gone.
const dump = (storage: StorageDouble) => [...storage.raw.entries()].flat().join('\n')

// Every stored value, parsed back as the helper would.
const storedValues = (storage: StorageDouble) => [...storage.raw.values()].map((s) => parse(s))

// A call that may throw synchronously or reject, as a promise.
const attempt = (fn: () => unknown) => Promise.resolve().then(fn)

const writeAllSetup = async (records: Records, account: Address = ACCOUNT) => {
  const six = records.setup(CHAIN_ID, account)
  await six.setupDraft.write(SETUP_SAMPLES.setupDraft)
  await six.inventory.write(SETUP_SAMPLES.inventory)
  await six.path.write(SETUP_SAMPLES.path)
  await six.enrollments.write(SETUP_SAMPLES.enrollments)
  await six.waitingPeriod.write(SETUP_SAMPLES.waitingPeriod)
  await six.passwordSet.write(SETUP_SAMPLES.passwordSet)
}

// The one line a wipe keeps for an event: the reason, the account and, for an
// expired request, its deadline. The submission landing keeps the landed state,
// the countdown's record, which holds the account address alone.
const wipedLine = (event: RecoveryWipeEvent): RecoverySessionRecord =>
  event === 'submission-landed'
    ? { state: 'landed', account: ACCOUNT }
    : {
        state: 'wiped',
        reason: event,
        account: ACCOUNT,
        ...(event === 'deadline-passed' ? { deadline: VALID_UNTIL } : {})
      }

const wipeFor = async (records: Records, event: RecoveryWipeEvent) => {
  if (event === 'submission-landed') await records.landSubmission(CHAIN_ID, ACCOUNT)
  else await records.wipeRecoverySession(CHAIN_ID, ACCOUNT, event)
}

describe('the six setup records', () => {
  SETUP_RECORD_NAMES.forEach((name: SetupRecordName) =>
    describe(name, () => {
      const accessorOf = (records: Records) =>
        records.setup(CHAIN_ID, ACCOUNT)[name] as unknown as {
          read(): Promise<RecordRead<unknown>>
          write(value: unknown): Promise<unknown>
          age(at?: number): Promise<number | null>
        }

      it('round-trips its value with its savedAt', async () => {
        const { records } = setup()
        await accessorOf(records).write(SETUP_SAMPLES[name])
        const read = present(await accessorOf(records).read())
        expect(read.savedAt).toBe(T0)
        expect(read.value).toEqual(SETUP_SAMPLES[name])
      })

      it('reports its age for a fixed now', async () => {
        const { records, clock } = setup()
        await accessorOf(records).write(SETUP_SAMPLES[name])
        expect(await accessorOf(records).age(T0 + 3 * HOUR)).toBe(3 * HOUR)
        clock.t = T0 + 5 * HOUR
        expect(await accessorOf(records).age()).toBe(5 * HOUR)
        expect(recordAge(await accessorOf(records).read(), T0 + HOUR)).toBe(HOUR)
      })

      it('reads as absent before any write, never as false or zero', async () => {
        const { records } = setup()
        const read = await accessorOf(records).read()
        expect(read).toBe(ABSENT)
        expect(read).not.toBe(false)
        expect(read).not.toBe(0)
        expect(await accessorOf(records).age(T0)).toBeNull()
      })
    })
  )

  it('reports the draft age as the latest savedAt of the six', async () => {
    const { records, clock } = setup()
    expect(await records.setupSavedAt(CHAIN_ID, ACCOUNT)).toBeNull()
    await records.setup(CHAIN_ID, ACCOUNT).setupDraft.write(SETUP_DRAFT)
    clock.t = T0 + HOUR
    await records.setup(CHAIN_ID, ACCOUNT).passwordSet.write('password-set')
    expect(await records.setupSavedAt(CHAIN_ID, ACCOUNT)).toBe(T0 + HOUR)
  })
  ;(
    [
      ['save', 'saveSetup'],
      ['start over', 'startOverSetup']
    ] as const
  ).forEach(([label, act]) =>
    it(`${label} wipes all six while platform credentials survive`, async () => {
      const { storage, records } = setup()
      await storage.set(PLATFORM_CREDENTIALS_KEY, PLATFORM_CREDENTIALS)
      await writeAllSetup(records)
      await records[act](CHAIN_ID, ACCOUNT)
      const six = records.setup(CHAIN_ID, ACCOUNT)
      const reads = await Promise.all(SETUP_RECORD_NAMES.map((name) => six[name].read()))
      reads.forEach((read) => expect(read).toBe(ABSENT))
      expect(await storage.get(PLATFORM_CREDENTIALS_KEY)).toEqual(PLATFORM_CREDENTIALS)
      expect([...storage.raw.keys()]).toEqual([PLATFORM_CREDENTIALS_KEY])
    })
  )

  it('keys the setup records by chain and account: a save on one leaves the other untouched', async () => {
    const { records } = setup()
    await writeAllSetup(records, ACCOUNT)
    await writeAllSetup(records, OTHER_ACCOUNT)
    await records.setup(1n, ACCOUNT).setupDraft.write(SETUP_DRAFT)
    await records.saveSetup(CHAIN_ID, ACCOUNT)
    expect(present(await records.setup(CHAIN_ID, OTHER_ACCOUNT).setupDraft.read()).value).toEqual(
      SETUP_DRAFT
    )
    expect(present(await records.setup(1n, ACCOUNT).setupDraft.read()).value).toEqual(SETUP_DRAFT)
  })

  it('keys the account case-insensitively, so a checksummed address reads the same record', async () => {
    const { records } = setup()
    const checksummed = '0xAbCdEf0000000000000000000000000000000001' as Address
    await records.setup(CHAIN_ID, checksummed).inventory.write(['passport'])
    const lower = checksummed.toLowerCase() as Address
    expect(present(await records.setup(CHAIN_ID, lower).inventory.read()).value).toEqual([
      'passport'
    ])
  })

  it('an enrollment keeps its passkey backup kind', async () => {
    const { records } = setup()
    const synced: Enrollment = { ...ENROLLMENT, backup: 'synced' }
    await records.setup(CHAIN_ID, ACCOUNT).enrollments.write([ENROLLMENT, synced])
    const { value } = present(await records.setup(CHAIN_ID, ACCOUNT).enrollments.read())
    expect(value.map((e) => e.backup)).toEqual(['device-bound', 'synced'])
  })
})

describe('an invalid address or chain id is refused, never stored under a bad key', () => {
  const BAD_ADDRESSES = ['', '0x', 'not-an-address', '0x123', `${ACCOUNT}00`, ACCOUNT.slice(2)]
  const BAD_CHAINS: unknown[] = [-1, -1n, 1.5, NaN, 'abc', '0x1']

  BAD_ADDRESSES.forEach((bad) =>
    it(`refuses the address '${bad}' and writes nothing`, async () => {
      const { storage, records } = setup()
      const addr = bad as Address
      await expect(
        attempt(() => records.setup(CHAIN_ID, addr).setupDraft.write(SETUP_DRAFT))
      ).rejects.toThrow()
      await expect(
        attempt(() => records.decryptedSetupCache(CHAIN_ID, addr).read())
      ).rejects.toThrow()
      await expect(attempt(() => records.saveSetup(CHAIN_ID, addr))).rejects.toThrow()
      await expect(
        attempt(() => records.recoverySession(CHAIN_ID, addr).write(GATHERING))
      ).rejects.toThrow()
      await expect(
        attempt(() => records.wipeRecoverySession(CHAIN_ID, addr, 'deadline-passed'))
      ).rejects.toThrow()
      await expect(attempt(() => records.countdown(CHAIN_ID, addr).read())).rejects.toThrow()
      await expect(attempt(() => records.landSubmission(CHAIN_ID, addr))).rejects.toThrow()
      await expect(attempt(() => records.clearWipedSession(CHAIN_ID, addr))).rejects.toThrow()
      await expect(attempt(() => records.endCountdown(CHAIN_ID, addr))).rejects.toThrow()
      expect(storage.raw.size).toBe(0)
    })
  )

  BAD_CHAINS.forEach((bad) =>
    it(`refuses the chain id ${String(bad)} and writes nothing`, async () => {
      const { storage, records } = setup()
      const chain = bad as bigint
      await expect(
        attempt(() => records.setup(chain, ACCOUNT).setupDraft.write(SETUP_DRAFT))
      ).rejects.toThrow()
      await expect(
        attempt(() => records.recoverySession(chain, ACCOUNT).write(GATHERING))
      ).rejects.toThrow()
      await expect(
        attempt(() => records.wipeRecoverySession(chain, ACCOUNT, 'deadline-passed'))
      ).rejects.toThrow()
      await expect(attempt(() => records.listRecoverySessions(chain))).rejects.toThrow()
      await expect(attempt(() => records.listCountdowns(chain))).rejects.toThrow()
      await expect(attempt(() => records.countdown(chain, ACCOUNT).read())).rejects.toThrow()
      await expect(attempt(() => records.clearWipedSession(chain, ACCOUNT))).rejects.toThrow()
      await expect(attempt(() => records.endCountdown(chain, ACCOUNT))).rejects.toThrow()
      expect(storage.raw.size).toBe(0)
    })
  )
})

describe('no record is a bare boolean or zero', () => {
  it('the password-set flag stores an object, not a boolean', async () => {
    const { storage, records } = setup()
    await records.setup(CHAIN_ID, ACCOUNT).passwordSet.write('password-set')
    expect(storage.raw.size).toBe(1)
    const [serialized] = [...storage.raw.values()]
    expect(['true', 'false', '0', '1', '']).not.toContain(serialized)
    const [stored] = storedValues(storage)
    expect(typeof stored).toBe('object')
    expect(stored).not.toBeNull()
    expect(stored).toEqual({ value: 'password-set', savedAt: T0 })
  })

  it('a waiting period of zero still reads as a stored fact, not as absent', async () => {
    const { records } = setup()
    await records.setup(CHAIN_ID, ACCOUNT).waitingPeriod.write(0n)
    expect(present(await records.setup(CHAIN_ID, ACCOUNT).waitingPeriod.read()).value).toBe(0n)
  })

  it('a bigint survives the rich JSON the helper stores', async () => {
    const { storage, records } = setup()
    await records.setup(CHAIN_ID, ACCOUNT).setupDraft.write(SETUP_DRAFT)
    expect(dump(storage)).toContain('$bigint')
    const { value } = present(await records.setup(CHAIN_ID, ACCOUNT).setupDraft.read())
    expect(typeof value.wait).toBe('bigint')
    expect(value.wait).toBe(86400n)
  })

  it('a record whose value is undefined loses its value key and reads as absent, never as present', async () => {
    const { storage, records } = setup()
    await records
      .setup(CHAIN_ID, ACCOUNT)
      .setupDraft.write(undefined as unknown as SetupRecordValues['setupDraft'])
    // What the extension would hold: `{"savedAt":…}`, with no `value` key.
    storedValues(storage).forEach((stored) => expect(stored).not.toHaveProperty('value'))
    expect(await records.setup(CHAIN_ID, ACCOUNT).setupDraft.read()).toBe(ABSENT)
  })

  it('a record stored at savedAt 0 still reads as present', async () => {
    const { records } = setup({ t: 0 })
    await records.setup(CHAIN_ID, ACCOUNT).inventory.write([])
    const read = present(await records.setup(CHAIN_ID, ACCOUNT).inventory.read())
    expect(read.savedAt).toBe(0)
    expect(read.value).toEqual([])
  })

  it('a bare false or 0 left under a record key reads as absent, never as a fact', async () => {
    const { storage, records } = setup()
    await records.setup(CHAIN_ID, ACCOUNT).passwordSet.write('password-set')
    const [key] = [...storage.raw.keys()]
    await storage.set(key, false)
    expect(await records.setup(CHAIN_ID, ACCOUNT).passwordSet.read()).toBe(ABSENT)
    await storage.set(key, 0)
    expect(await records.setup(CHAIN_ID, ACCOUNT).passwordSet.read()).toBe(ABSENT)
  })

  it('every value the records write is a truthy object', async () => {
    const { storage, records } = setup()
    await writeAllSetup(records)
    await records.setup(CHAIN_ID, OTHER_ACCOUNT).waitingPeriod.write(0n)
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    await records.landSubmission(CHAIN_ID, ACCOUNT)
    await records.decryptedSetupCache(CHAIN_ID, ACCOUNT).write(CACHE)
    await records.recoverySession(CHAIN_ID, OTHER_ACCOUNT).write(gathering(OTHER_ACCOUNT, []))
    await records.wipeRecoverySession(CHAIN_ID, OTHER_ACCOUNT, 'deadline-passed')
    expect(storage.raw.size).toBeGreaterThanOrEqual(10)
    storedValues(storage).forEach((value) => {
      expect(typeof value).toBe('object')
      expect(value).not.toBeNull()
      expect(!value).toBe(false)
    })
  })
})

describe('the recovery session', () => {
  it('round-trips the approvals and the predicted attempt id', async () => {
    const { storage, records } = setup()
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    const read = present(await records.recoverySession(CHAIN_ID, ACCOUNT).read())
    expect(read.savedAt).toBe(T0)
    expect(read.value).toEqual({ state: 'live', gathering: GATHERING })
    if (read.value.state !== 'live') throw new Error('expected a live session')
    expect(read.value.gathering.replies).toEqual(APPROVALS)
    expect(read.value.gathering.replies.map((r) => r.proof)).toEqual([PROOF_A, PROOF_B])
    expect(predictedAttemptId(read.value)).toBe(PREDICTED_ATTEMPT_ID)
    expect(dump(storage)).toContain(PROOF_A)
  })

  it('reads as absent before any write', async () => {
    const { records } = setup()
    expect(await records.recoverySession(CHAIN_ID, ACCOUNT).read()).toBe(ABSENT)
  })

  it('gathers approvals across writes of the same request', async () => {
    const { records } = setup()
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(gathering(ACCOUNT, [APPROVALS[0]]))
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    const read = present(await records.recoverySession(CHAIN_ID, ACCOUNT).read())
    expect(read.value).toEqual({ state: 'live', gathering: GATHERING })
  })

  it('a write never replaces a live request: that would be a sixth wipe', async () => {
    const { storage, records } = setup()
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    const before = dump(storage)
    await expect(
      records.recoverySession(CHAIN_ID, ACCOUNT).write(gathering(ACCOUNT, [], { attemptId: '8' }))
    ).rejects.toThrow()
    await expect(
      records
        .recoverySession(CHAIN_ID, ACCOUNT)
        .write(gathering(ACCOUNT, [], { validUntil: '1800000000' }))
    ).rejects.toThrow()
    expect(dump(storage)).toBe(before)
  })

  it('a write refuses a gathering for another account or chain, or a cancellation', async () => {
    const { storage, records } = setup()
    await expect(
      records.recoverySession(CHAIN_ID, ACCOUNT).write(gathering(OTHER_ACCOUNT))
    ).rejects.toThrow()
    await expect(
      records
        .recoverySession(CHAIN_ID, ACCOUNT)
        .write(gathering(ACCOUNT, APPROVALS, { chainId: '1' }))
    ).rejects.toThrow()
    await expect(
      records.recoverySession(CHAIN_ID, ACCOUNT).write({ ...GATHERING, purpose: 'cancellation' })
    ).rejects.toThrow()
    expect(storage.raw.size).toBe(0)
  })
  ;['security-stop', 'securityStop', 'pause', 'cancelled', ''].forEach((event) =>
    it(`refuses '${event}', outside the vocabulary, and wipes nothing`, async () => {
      const { storage, records } = setup()
      await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
      const before = dump(storage)
      await expect(
        records.wipeRecoverySession(CHAIN_ID, ACCOUNT, event as DirectWipeEvent)
      ).rejects.toThrow()
      expect(dump(storage)).toBe(before)
      expect(present(await records.recoverySession(CHAIN_ID, ACCOUNT).read()).value).toEqual({
        state: 'live',
        gathering: GATHERING
      })
    })
  )

  FIVE_EVENTS.forEach((event) =>
    describe(`the ${event} event`, () => {
      it('wipes the approvals and the predicted attempt id and keeps exactly its reason line', async () => {
        const { storage, records } = setup()
        await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
        await wipeFor(records, event)
        const read = present(await records.recoverySession(CHAIN_ID, ACCOUNT).read())
        expect(read.value).toEqual(wipedLine(event))
        const text = dump(storage)
        expect(text).not.toContain(PROOF_A)
        expect(text).not.toContain(PROOF_B)
        expect(text).not.toContain('gathering')
        expect(text).not.toContain('replies')
        expect(text).not.toContain('attemptId')
        expect(text).not.toContain('setupBody')
        expect(text).not.toContain('digest')
      })
    })
  )

  it('a later wipe keeps only its own reason, one line and not a list', async () => {
    const { records } = setup()
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    await records.wipeRecoverySession(CHAIN_ID, ACCOUNT, 'deadline-passed')
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    await records.wipeRecoverySession(CHAIN_ID, ACCOUNT, 'setup-changed')
    expect(present(await records.recoverySession(CHAIN_ID, ACCOUNT).read()).value).toEqual(
      wipedLine('setup-changed')
    )
  })

  it('the session lives in storage alone: a fresh instance after a worker restart resumes it with its age', async () => {
    const { storage, records, clock } = setup()
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    const before = dump(storage)
    clock.t = T0 + 10 * HOUR
    // A worker restart drops every in-memory object; only the storage stays.
    const restarted = createWalletRecords({ storage, now: () => clock.t })
    const read = present(await restarted.recoverySession(CHAIN_ID, ACCOUNT).read())
    expect(read.value).toEqual({ state: 'live', gathering: GATHERING })
    expect(await restarted.recoverySession(CHAIN_ID, ACCOUNT).age()).toBe(10 * HOUR)
    expect(await restarted.listRecoverySessions(CHAIN_ID)).toHaveLength(1)
    // Reading and resuming wrote nothing: a pause is not a write.
    expect(dump(storage)).toBe(before)
  })

  it('a pause is no wipe event: asked to wipe for a pause, the records refuse and the approvals stay', async () => {
    const { storage, records } = setup()
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    const before = dump(storage)
    await expect(
      records.wipeRecoverySession(CHAIN_ID, ACCOUNT, 'pause' as DirectWipeEvent)
    ).rejects.toThrow()
    expect(dump(storage)).toBe(before)
    expect(dump(storage)).toContain(PROOF_A)
  })

  it('a wipe with no session writes nothing and reports that it wiped nothing', async () => {
    const { storage, records } = setup()
    const wiped = await records.wipeRecoverySession(CHAIN_ID, ACCOUNT, 'deadline-passed')
    expect(wiped).toBe(false)
    expect(storage.raw.size).toBe(0)
    expect(await records.recoverySession(CHAIN_ID, ACCOUNT).read()).toBe(ABSENT)
  })

  DIRECT_EVENTS.forEach((event) =>
    it(`a wipe of a live session for ${event} reports that it wiped`, async () => {
      const { records } = setup()
      await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
      expect(await records.wipeRecoverySession(CHAIN_ID, ACCOUNT, event)).toBe(true)
    })
  )

  it('a wipe after the submission landed changes nothing: the reason and the countdown stay', async () => {
    const { storage, records } = setup()
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    await records.landSubmission(CHAIN_ID, ACCOUNT)
    const before = dump(storage)
    expect(await records.wipeRecoverySession(CHAIN_ID, ACCOUNT, 'deadline-passed')).toBe(false)
    expect(dump(storage)).toBe(before)
    expect(present(await records.recoverySession(CHAIN_ID, ACCOUNT).read()).value).toEqual(
      wipedLine('submission-landed')
    )
    expect(present(await records.countdown(CHAIN_ID, ACCOUNT).read()).value).toEqual({
      account: ACCOUNT
    })
  })

  it('the direct wipe refuses submission-landed: only landing the submission writes the countdown', async () => {
    const { storage, records } = setup()
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    const before = dump(storage)
    await expect(
      records.wipeRecoverySession(CHAIN_ID, ACCOUNT, 'submission-landed' as DirectWipeEvent)
    ).rejects.toThrow()
    expect(dump(storage)).toBe(before)
  })

  it('two accounts on one chain keep two sessions, with no silent overwrite', async () => {
    const { storage, records } = setup()
    const other = gathering(OTHER_ACCOUNT, [reply(0, PROOF_B, OTHER_ACCOUNT)])
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    await records.recoverySession(CHAIN_ID, OTHER_ACCOUNT).write(other)
    expect(present(await records.recoverySession(CHAIN_ID, ACCOUNT).read()).value).toEqual({
      state: 'live',
      gathering: GATHERING
    })
    expect(present(await records.recoverySession(CHAIN_ID, OTHER_ACCOUNT).read()).value).toEqual({
      state: 'live',
      gathering: other
    })
    const listed = await records.listRecoverySessions(CHAIN_ID)
    expect(listed.map((l) => l.account.toLowerCase()).sort()).toEqual(
      [ACCOUNT, OTHER_ACCOUNT].map((a) => a.toLowerCase()).sort()
    )
    // A wipe on one account leaves the other live.
    await records.wipeRecoverySession(CHAIN_ID, ACCOUNT, 'recoverer-abandoned')
    expect(present(await records.recoverySession(CHAIN_ID, OTHER_ACCOUNT).read()).value).toEqual({
      state: 'live',
      gathering: other
    })
    expect(dump(storage)).toContain(PROOF_B)
    expect(dump(storage)).not.toContain(PROOF_A)
    // Another chain holds nothing of either.
    expect(await records.listRecoverySessions(1n)).toEqual([])
  })

  it('the death states render from the reason line alone: expired, void, setup changed', async () => {
    expect(WIPE_REASON_STRING_KEYS['deadline-passed']?.title).toMatch(/expired/i)
    expect(WIPE_REASON_STRING_KEYS['another-attempt-opened']?.title).toMatch(/void/i)
    expect(WIPE_REASON_STRING_KEYS['setup-changed']?.title).toMatch(/setupChanged/)
    const strings = (en as { socialRecovery: { records: Record<string, string> } }).socialRecovery
      .records
    Object.values(WIPE_REASON_STRING_KEYS).forEach((keys) => {
      if (!keys) return
      ;[keys.title, keys.body].forEach((k) => {
        expect(k.startsWith('socialRecovery.records.')).toBe(true)
        expect(typeof strings[k.slice('socialRecovery.records.'.length)]).toBe('string')
      })
    })
    // The expired body interpolates the deadline, which the wiped line carries.
    expect(strings.expiredBody).toContain('{{deadline}}')
    const { records } = setup()
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    await records.wipeRecoverySession(CHAIN_ID, ACCOUNT, 'deadline-passed')
    const line = present(await records.recoverySession(CHAIN_ID, ACCOUNT).read()).value
    expect(line).toMatchObject({ reason: 'deadline-passed', deadline: VALID_UNTIL })
  })
})

describe('the countdown record after the submission lands', () => {
  it('holds the account address alone and the session is gone', async () => {
    const { records } = setup()
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    await records.landSubmission(CHAIN_ID, ACCOUNT)
    const countdown = present(await records.countdown(CHAIN_ID, ACCOUNT).read())
    expect(countdown.value).toEqual({ account: ACCOUNT })
    expect(countdown.savedAt).toBe(T0)
    expect(present(await records.recoverySession(CHAIN_ID, ACCOUNT).read()).value).toEqual(
      wipedLine('submission-landed')
    )
    const listed = await records.listCountdowns(CHAIN_ID)
    expect(listed).toHaveLength(1)
    expect(listed[0].record.value).toEqual({ account: ACCOUNT })
  })

  it('takes the account from the live session', async () => {
    const { records } = setup()
    const checksummed = '0xAbCdEf0000000000000000000000000000000001' as Address
    await records.recoverySession(CHAIN_ID, checksummed).write(gathering(checksummed, []))
    await records.landSubmission(CHAIN_ID, checksummed.toLowerCase() as Address)
    expect(present(await records.countdown(CHAIN_ID, checksummed).read()).value).toEqual({
      account: checksummed
    })
  })

  it('refuses a landing with no live session and writes nothing', async () => {
    const { storage, records } = setup()
    await expect(records.landSubmission(CHAIN_ID, ACCOUNT)).rejects.toThrow()
    expect(storage.raw.size).toBe(0)
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    await records.wipeRecoverySession(CHAIN_ID, ACCOUNT, 'recoverer-abandoned')
    const before = dump(storage)
    await expect(records.landSubmission(CHAIN_ID, ACCOUNT)).rejects.toThrow()
    expect(dump(storage)).toBe(before)
    expect(await records.countdown(CHAIN_ID, ACCOUNT).read()).toBe(ABSENT)
  })

  DIRECT_EVENTS.forEach((event) =>
    it(`no countdown record follows ${event}`, async () => {
      const { records } = setup()
      await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
      await records.wipeRecoverySession(CHAIN_ID, ACCOUNT, event)
      expect(await records.countdown(CHAIN_ID, ACCOUNT).read()).toBe(ABSENT)
      expect(await records.listCountdowns(CHAIN_ID)).toEqual([])
    })
  )

  it('ends with endCountdown, and leaves the listing empty', async () => {
    const { records } = setup()
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    await records.landSubmission(CHAIN_ID, ACCOUNT)
    expect(await records.endCountdown(CHAIN_ID, ACCOUNT)).toBe(true)
    expect(await records.countdown(CHAIN_ID, ACCOUNT).read()).toBe(ABSENT)
    expect(await records.listCountdowns(CHAIN_ID)).toEqual([])
  })

  it('reports its age from the landing', async () => {
    const { records, clock } = setup()
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    clock.t = T0 + HOUR
    await records.landSubmission(CHAIN_ID, ACCOUNT)
    expect(await records.countdown(CHAIN_ID, ACCOUNT).age(T0 + 4 * HOUR)).toBe(3 * HOUR)
  })

  it('a new gathering cannot overwrite a landed session: the countdown stays', async () => {
    const { storage, records } = setup()
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    await records.landSubmission(CHAIN_ID, ACCOUNT)
    const before = dump(storage)
    await expect(
      records.recoverySession(CHAIN_ID, ACCOUNT).write(gathering(ACCOUNT, [], { attemptId: '8' }))
    ).rejects.toThrow()
    expect(dump(storage)).toBe(before)
    expect(present(await records.countdown(CHAIN_ID, ACCOUNT).read()).value).toEqual({
      account: ACCOUNT
    })
  })

  it('a second landing is refused and changes nothing', async () => {
    const { storage, records } = setup()
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    await records.landSubmission(CHAIN_ID, ACCOUNT)
    const before = dump(storage)
    await expect(records.landSubmission(CHAIN_ID, ACCOUNT)).rejects.toThrow()
    expect(dump(storage)).toBe(before)
  })
})

describe('the decrypted setup cache after execution', () => {
  it('reads as absent before any write', async () => {
    const { records } = setup()
    expect(await records.decryptedSetupCache(CHAIN_ID, ACCOUNT).read()).toBe(ABSENT)
  })

  it('holds the decrypted setup and its nonce as bigints, readable without the password after a worker restart', async () => {
    const { storage, records, clock } = setup()
    await records.decryptedSetupCache(CHAIN_ID, ACCOUNT).write(CACHE)
    // The stored string carries the configuration, not a pointer to it.
    expect(dump(storage)).toContain(METHOD)
    clock.t = T0 + 2 * HOUR
    const restarted = createWalletRecords({ storage, now: () => clock.t })
    const cache = present(await restarted.decryptedSetupCache(CHAIN_ID, ACCOUNT).read())
    expect(cache.value).toEqual(CACHE)
    expect(typeof cache.value.configuration.wait).toBe('bigint')
    expect(cache.value.setupNonce).toBe(3n)
    expect(await restarted.decryptedSetupCache(CHAIN_ID, ACCOUNT).age()).toBe(2 * HOUR)
  })

  it('is this account on this chain alone: another account or chain has no cache', async () => {
    const { records } = setup()
    await records.decryptedSetupCache(CHAIN_ID, ACCOUNT).write(CACHE)
    expect(await records.decryptedSetupCache(CHAIN_ID, OTHER_ACCOUNT).read()).toBe(ABSENT)
    expect(await records.decryptedSetupCache(1n, ACCOUNT).read()).toBe(ABSENT)
  })

  it('a re-import from the chain replaces the cache and restamps its age', async () => {
    const { records, clock } = setup()
    await records.decryptedSetupCache(CHAIN_ID, ACCOUNT).write(CACHE)
    clock.t = T0 + HOUR
    const reimported: DecryptedSetupCacheRecord = {
      configuration: { ...CONFIGURATION, wait: 172800n },
      setupNonce: 4n
    }
    await records.decryptedSetupCache(CHAIN_ID, ACCOUNT).write(reimported)
    const cache = present(await records.decryptedSetupCache(CHAIN_ID, ACCOUNT).read())
    expect(cache.value).toEqual(reimported)
    expect(cache.savedAt).toBe(T0 + HOUR)
  })

  it('outlives the recovery: after the landing, the countdown ending and the setup wipes, the cache still reads', async () => {
    const { records } = setup()
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    await records.landSubmission(CHAIN_ID, ACCOUNT)
    // The recovery executes: the unlocked setup becomes this device's cache
    // and the countdown ends.
    await records.decryptedSetupCache(CHAIN_ID, ACCOUNT).write(CACHE)
    expect(await records.endCountdown(CHAIN_ID, ACCOUNT)).toBe(true)
    expect(await records.countdown(CHAIN_ID, ACCOUNT).read()).toBe(ABSENT)
    await records.saveSetup(CHAIN_ID, ACCOUNT)
    await records.startOverSetup(CHAIN_ID, ACCOUNT)
    const cache = present(await records.decryptedSetupCache(CHAIN_ID, ACCOUNT).read())
    expect(cache.value).toEqual(CACHE)
  })
})

describe('the session survives the submission as the countdown record, with no index record', () => {
  const landAndReset = async () => {
    const ctx = setup()
    await ctx.records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    ctx.storage.calls.set.length = 0
    ctx.storage.calls.remove.length = 0
    await ctx.records.landSubmission(CHAIN_ID, ACCOUNT)
    return ctx
  }

  it('landing is one write: a single set call, no remove', async () => {
    const { storage } = await landAndReset()
    expect(storage.calls.set).toHaveLength(1)
    expect(storage.calls.remove).toEqual([])
  })

  it('the landed session record holds the account address alone, and the countdown reads back from it', async () => {
    const { storage, records } = await landAndReset()
    // One record on this device: the session's own key.
    expect(storage.raw.size).toBe(1)
    const [key] = [...storage.raw.keys()]
    expect(key).toBe(storage.calls.set[0])
    expect(present(await records.recoverySession(CHAIN_ID, ACCOUNT).read()).value).toEqual({
      state: 'landed',
      account: ACCOUNT
    })
    expect(present(await records.countdown(CHAIN_ID, ACCOUNT).read()).value).toEqual({
      account: ACCOUNT
    })
    const text = dump(storage)
    expect(text).not.toContain(PROOF_A)
    expect(text).not.toContain('attemptId')
  })

  it('listCountdowns and listRecoverySessions come from a prefix scan, with no index key present', async () => {
    const { storage, records } = setup()
    await storage.set(PLATFORM_CREDENTIALS_KEY, PLATFORM_CREDENTIALS)
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    await records.landSubmission(CHAIN_ID, ACCOUNT)
    await records
      .recoverySession(CHAIN_ID, OTHER_ACCOUNT)
      .write(gathering(OTHER_ACCOUNT, [reply(0, PROOF_B, OTHER_ACCOUNT)]))
    await records.recoverySession(1n, ACCOUNT).write(gathering(ACCOUNT, [], { chainId: '1' }))
    await records.landSubmission(1n, ACCOUNT)
    expect([...storage.raw.keys()].filter((k) => /index/i.test(k))).toEqual([])
    const countdowns = await records.listCountdowns(CHAIN_ID)
    expect(countdowns.map((c) => c.account.toLowerCase())).toEqual([ACCOUNT.toLowerCase()])
    const sessions = await records.listRecoverySessions(CHAIN_ID)
    expect(sessions.map((s) => s.account.toLowerCase()).sort()).toEqual(
      [ACCOUNT, OTHER_ACCOUNT].map((a) => a.toLowerCase()).sort()
    )
  })

  it('the scan skips a key under the prefix that names no account, and a value that is no session', async () => {
    const { storage, records } = await landAndReset()
    await storage.set(`socialRecovery:recoverySession:${CHAIN_ID}:junk`, { value: {}, savedAt: T0 })
    await storage.set(`socialRecovery:recoverySession:${CHAIN_ID}:${OTHER_ACCOUNT.toLowerCase()}`, {
      value: { state: 'unknown' },
      savedAt: T0
    })
    const sessions = await records.listRecoverySessions(CHAIN_ID)
    expect(sessions.map((s) => s.account.toLowerCase())).toEqual([ACCOUNT.toLowerCase()])
  })

  it('a storage without getAll cannot list, and says so', async () => {
    const { storage } = setup()
    const { getAll, ...withoutGetAll } = storage
    expect(getAll).toBeDefined()
    const records = createWalletRecords({ storage: withoutGetAll, now: () => T0 })
    await expect(records.listRecoverySessions(CHAIN_ID)).rejects.toThrow(/getAll/)
    await expect(records.listCountdowns(CHAIN_ID)).rejects.toThrow(/getAll/)
  })

  it('every wipe is one write too', async () => {
    const { storage, records } = setup()
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    storage.calls.set.length = 0
    await records.wipeRecoverySession(CHAIN_ID, ACCOUNT, 'setup-changed')
    expect(storage.calls.set).toHaveLength(1)
    expect(storage.calls.remove).toEqual([])
  })

  it('the scan finds a record written before this instance existed', async () => {
    const { storage } = await landAndReset()
    const restarted = createWalletRecords({ storage, now: () => T0 })
    const listed = await restarted.listCountdowns(CHAIN_ID)
    expect(listed).toHaveLength(1)
    expect(listed[0].record.value).toEqual({ account: ACCOUNT })
  })
})

describe('a live request is compared whole, and its replies only grow', () => {
  const REQUEST_VARIANTS: [string, Partial<Gathering['request']>][] = [
    ['setupBody', { setupBody: '0x01' }],
    ['digestVersion', { digestVersion: '2' }],
    ['payload', { payload: '0x1234' }],
    ['block hash', { block: { number: 1, timestamp: '1700000000', hash: '0x02' } }]
  ]

  REQUEST_VARIANTS.forEach(([label, change]) =>
    it(`two requests in the same block that differ only in ${label} are told apart`, async () => {
      const { storage, records } = setup()
      await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
      const before = dump(storage)
      await expect(
        records.recoverySession(CHAIN_ID, ACCOUNT).write(gathering(ACCOUNT, APPROVALS, change))
      ).rejects.toThrow()
      expect(dump(storage)).toBe(before)
    })
  )

  it('a write with fewer replies is refused', async () => {
    const { storage, records } = setup()
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    const before = dump(storage)
    await expect(
      records.recoverySession(CHAIN_ID, ACCOUNT).write(gathering(ACCOUNT, [APPROVALS[0]]))
    ).rejects.toThrow()
    await expect(
      records.recoverySession(CHAIN_ID, ACCOUNT).write(gathering(ACCOUNT, []))
    ).rejects.toThrow()
    expect(dump(storage)).toBe(before)
  })

  it('a write that swaps a stored reply for another is refused, even at the same count', async () => {
    const { storage, records } = setup()
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    const before = dump(storage)
    const swapped = [APPROVALS[0], reply(2, '0xabababab')]
    await expect(
      records.recoverySession(CHAIN_ID, ACCOUNT).write(gathering(ACCOUNT, swapped))
    ).rejects.toThrow()
    expect(dump(storage)).toBe(before)
  })

  it('a later reply for the same place displaces the stored one', async () => {
    const { records } = setup()
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    const displaced = gathering(ACCOUNT, [APPROVALS[0], reply(1, '0xabababab')])
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(displaced)
    expect(present(await records.recoverySession(CHAIN_ID, ACCOUNT).read()).value).toEqual({
      state: 'live',
      gathering: displaced
    })
  })

  it('a write that keeps every stored reply and adds one is taken', async () => {
    const { records } = setup()
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(gathering(ACCOUNT, [APPROVALS[0]]))
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    expect(present(await records.recoverySession(CHAIN_ID, ACCOUNT).read()).value).toEqual({
      state: 'live',
      gathering: GATHERING
    })
  })
})

describe('clearWipedSession removes only a wiped session', () => {
  it('refuses a live session: reports false, removes nothing and keeps its approvals', async () => {
    const { storage, records } = setup()
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    const before = dump(storage)
    storage.calls.remove.length = 0
    expect(await records.clearWipedSession(CHAIN_ID, ACCOUNT)).toBe(false)
    expect(storage.calls.remove).toEqual([])
    expect(dump(storage)).toBe(before)
    expect(dump(storage)).toContain(PROOF_A)
  })

  it('reports false with no session and removes nothing', async () => {
    const { storage, records } = setup()
    expect(await records.clearWipedSession(CHAIN_ID, ACCOUNT)).toBe(false)
    expect(storage.calls.remove).toEqual([])
  })

  DIRECT_EVENTS.forEach((event) =>
    it(`clears a session wiped by ${event}`, async () => {
      const { storage, records } = setup()
      await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
      await records.wipeRecoverySession(CHAIN_ID, ACCOUNT, event)
      expect(await records.clearWipedSession(CHAIN_ID, ACCOUNT)).toBe(true)
      expect(await records.recoverySession(CHAIN_ID, ACCOUNT).read()).toBe(ABSENT)
      expect(storage.raw.size).toBe(0)
    })
  )

  it('refuses a landed session: reports false and the countdown keeps running', async () => {
    const { storage, records } = setup()
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    await records.landSubmission(CHAIN_ID, ACCOUNT)
    const before = dump(storage)
    storage.calls.remove.length = 0
    expect(await records.clearWipedSession(CHAIN_ID, ACCOUNT)).toBe(false)
    expect(storage.calls.remove).toEqual([])
    expect(dump(storage)).toBe(before)
    expect(present(await records.countdown(CHAIN_ID, ACCOUNT).read()).value).toEqual({
      account: ACCOUNT
    })
    expect(await records.listCountdowns(CHAIN_ID)).toHaveLength(1)
  })

  it('a loop that clears every non-live session leaves running countdowns in place', async () => {
    const { records } = setup()
    const third = '0x6666666666666666666666666666666666666666' as Address
    // A running countdown, a wiped session and a live session on one chain.
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    await records.landSubmission(CHAIN_ID, ACCOUNT)
    await records.recoverySession(CHAIN_ID, OTHER_ACCOUNT).write(gathering(OTHER_ACCOUNT, []))
    await records.wipeRecoverySession(CHAIN_ID, OTHER_ACCOUNT, 'deadline-passed')
    const live = gathering(third, [reply(0, PROOF_B, third)])
    await records.recoverySession(CHAIN_ID, third).write(live)
    const listed = await records.listRecoverySessions(CHAIN_ID)
    const cleared = await Promise.all(
      listed
        .filter(({ record }) => record.value.state !== 'live')
        .map(({ account }) => records.clearWipedSession(CHAIN_ID, account))
    )
    expect(cleared.sort()).toEqual([false, true])
    expect(await records.recoverySession(CHAIN_ID, OTHER_ACCOUNT).read()).toBe(ABSENT)
    expect(present(await records.countdown(CHAIN_ID, ACCOUNT).read()).value).toEqual({
      account: ACCOUNT
    })
    expect((await records.listCountdowns(CHAIN_ID)).map((c) => c.account)).toEqual([ACCOUNT])
    expect(present(await records.recoverySession(CHAIN_ID, third).read()).value).toEqual({
      state: 'live',
      gathering: live
    })
  })

  it('after a clear, a new gathering may start', async () => {
    const { records } = setup()
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    await records.wipeRecoverySession(CHAIN_ID, ACCOUNT, 'another-attempt-opened')
    await records.clearWipedSession(CHAIN_ID, ACCOUNT)
    const fresh = gathering(ACCOUNT, [], { attemptId: '8' })
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(fresh)
    expect(present(await records.recoverySession(CHAIN_ID, ACCOUNT).read()).value).toEqual({
      state: 'live',
      gathering: fresh
    })
  })

  it('leaves another account untouched', async () => {
    const { records } = setup()
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    await records.wipeRecoverySession(CHAIN_ID, ACCOUNT, 'recoverer-abandoned')
    const other = gathering(OTHER_ACCOUNT, [reply(0, PROOF_B, OTHER_ACCOUNT)])
    await records.recoverySession(CHAIN_ID, OTHER_ACCOUNT).write(other)
    await records.clearWipedSession(CHAIN_ID, ACCOUNT)
    expect(present(await records.recoverySession(CHAIN_ID, OTHER_ACCOUNT).read()).value).toEqual({
      state: 'live',
      gathering: other
    })
  })
})

describe('endCountdown removes only a landed session', () => {
  it('ends a landed session: reports true, and the listing of countdowns is then empty', async () => {
    const { storage, records } = setup()
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    await records.landSubmission(CHAIN_ID, ACCOUNT)
    expect(await records.endCountdown(CHAIN_ID, ACCOUNT)).toBe(true)
    expect(await records.countdown(CHAIN_ID, ACCOUNT).read()).toBe(ABSENT)
    expect(await records.listCountdowns(CHAIN_ID)).toEqual([])
    expect(storage.raw.size).toBe(0)
  })

  it('refuses a live session: reports false and keeps its approvals', async () => {
    const { storage, records } = setup()
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    const before = dump(storage)
    storage.calls.remove.length = 0
    expect(await records.endCountdown(CHAIN_ID, ACCOUNT)).toBe(false)
    expect(storage.calls.remove).toEqual([])
    expect(dump(storage)).toBe(before)
  })

  DIRECT_EVENTS.forEach((event) =>
    it(`refuses a session wiped by ${event}: reports false and keeps its reason`, async () => {
      const { storage, records } = setup()
      await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
      await records.wipeRecoverySession(CHAIN_ID, ACCOUNT, event)
      const before = dump(storage)
      storage.calls.remove.length = 0
      expect(await records.endCountdown(CHAIN_ID, ACCOUNT)).toBe(false)
      expect(storage.calls.remove).toEqual([])
      expect(dump(storage)).toBe(before)
      expect(present(await records.recoverySession(CHAIN_ID, ACCOUNT).read()).value).toEqual(
        wipedLine(event)
      )
    })
  )

  it('reports false with no session and removes nothing', async () => {
    const { storage, records } = setup()
    expect(await records.endCountdown(CHAIN_ID, ACCOUNT)).toBe(false)
    expect(storage.calls.remove).toEqual([])
  })

  it('ends one account countdown and leaves another running', async () => {
    const { records } = setup()
    await records.recoverySession(CHAIN_ID, ACCOUNT).write(GATHERING)
    await records.landSubmission(CHAIN_ID, ACCOUNT)
    await records.recoverySession(CHAIN_ID, OTHER_ACCOUNT).write(gathering(OTHER_ACCOUNT, []))
    await records.landSubmission(CHAIN_ID, OTHER_ACCOUNT)
    expect(await records.endCountdown(CHAIN_ID, ACCOUNT)).toBe(true)
    expect((await records.listCountdowns(CHAIN_ID)).map((c) => c.account)).toEqual([OTHER_ACCOUNT])
  })
})
