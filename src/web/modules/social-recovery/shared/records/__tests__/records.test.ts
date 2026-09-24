/**
 * PT-040 The wallet's records: the done entries of
 * docs/social-recovery/tasks/PT-040-the-wallet-s-records.md, per the brief's
 * "Test expectations" (docs/social-recovery/briefs/PT-040.md), D-310, D-370,
 * D-392, D-393 and I-38.
 *
 * Every test runs against an in-memory double of
 * src/web/extension-services/background/webapi/storage.ts that keeps its
 * falsy-default rule: `get` returns the default when the stored value is falsy.
 */
import en from '@common/config/localization/translations/en.json'
import type {
  Address,
  ApproverReply,
  Configuration,
  SetupDraft
} from '@web/modules/social-recovery/sdk-interfaces'
import {
  ABSENT,
  createWalletRecords,
  Enrollment,
  RECOVERY_WIPE_EVENTS,
  recordAge,
  RecordRead,
  RecoveryWipeEvent,
  SETUP_RECORD_NAMES,
  SetupRecordName,
  SetupRecordValues,
  WIPE_REASON_STRING_KEYS
} from '@web/modules/social-recovery/shared/records'

// ---------------------------------------------------------------------------
// The storage double
// ---------------------------------------------------------------------------

type StorageDouble = {
  get: (key: string, defaultValue?: unknown) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<null>
  remove: (key: string) => Promise<null>
  raw: Map<string, unknown>
}

const clone = <T>(value: T): T => (value === undefined ? value : structuredClone(value))

const makeStorage = (): StorageDouble => {
  const raw = new Map<string, unknown>()
  return {
    raw,
    // The helper's rule: `if (!res[key]) return defaultValue`.
    get: async (key, defaultValue) => {
      const stored = raw.get(key)
      if (!stored) return defaultValue
      return clone(stored)
    },
    set: async (key, value) => {
      raw.set(key, clone(value))
      return null
    },
    remove: async (key) => {
      raw.delete(key)
      return null
    }
  }
}

// A record the platform keeps for the holder's credentials: not a record of
// this lane, and neither save nor start over may touch it (D-310).
const PLATFORM_CREDENTIALS_KEY = 'keystoreKeys'
const PLATFORM_CREDENTIALS = [{ addr: '0xCredential', type: 'internal', label: 'passkey' }]

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACCOUNT: Address = '0x1111111111111111111111111111111111111111'
const OTHER_ACCOUNT: Address = '0x2222222222222222222222222222222222222222'
const METHOD: Address = '0x3333333333333333333333333333333333333333'
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
  test: 'passed'
}

// One sample value per setup record, in D-310's order.
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

const PREDICTED_ATTEMPT_ID = 7n
const SIGNATURE_A = '0xdeadbeef'
const SIGNATURE_B = '0xfeedface'
// Only the fields the lane stores matter here; the reply is opaque to it.
const APPROVALS = [
  { kind: 'recovery-proof-reply', place: 0, signature: SIGNATURE_A },
  { kind: 'recovery-proof-reply', place: 1, signature: SIGNATURE_B }
] as unknown as ApproverReply[]

const SESSION = {
  account: ACCOUNT,
  predictedAttemptId: PREDICTED_ATTEMPT_ID,
  approvals: APPROVALS
}

// D-310's five events, in its order.
const FIVE_EVENTS: RecoveryWipeEvent[] = [
  'submission-landed',
  'deadline-passed',
  'another-attempt-opened',
  'setup-changed',
  'recoverer-abandoned'
]

const setup = (clock: { t: number } = { t: T0 }) => {
  const storage = makeStorage()
  const records = createWalletRecords({ storage, now: () => clock.t })
  return { storage, records, clock }
}

const present = <T>(read: RecordRead<T>) => {
  if (read.status !== 'present') throw new Error('expected a present record')
  return read
}

// Every stored value as text, with bigints spelt out, to prove a secret is gone.
const dump = (storage: StorageDouble) =>
  JSON.stringify([...storage.raw.entries()], (_k, v) => (typeof v === 'bigint' ? `${v}n` : v))

const writeAllSetup = async (
  records: ReturnType<typeof createWalletRecords>,
  account: Address = ACCOUNT
) => {
  const six = records.setup(CHAIN_ID, account)
  await six.setupDraft.write(SETUP_SAMPLES.setupDraft)
  await six.inventory.write(SETUP_SAMPLES.inventory)
  await six.path.write(SETUP_SAMPLES.path)
  await six.enrollments.write(SETUP_SAMPLES.enrollments)
  await six.waitingPeriod.write(SETUP_SAMPLES.waitingPeriod)
  await six.passwordSet.write(SETUP_SAMPLES.passwordSet)
}

// ---------------------------------------------------------------------------
// The six setup records
// ---------------------------------------------------------------------------

describe('the six setup records (D-310)', () => {
  it('names exactly the six setup records', () => {
    expect([...SETUP_RECORD_NAMES].sort()).toEqual(
      ['setupDraft', 'inventory', 'path', 'enrollments', 'waitingPeriod', 'passwordSet'].sort()
    )
  })

  SETUP_RECORD_NAMES.forEach((name: SetupRecordName) =>
    describe(name, () => {
      const accessorOf = (records: ReturnType<typeof createWalletRecords>) =>
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
})

// ---------------------------------------------------------------------------
// No bare boolean or zero
// ---------------------------------------------------------------------------

describe('no record is a bare boolean or zero (D-310, D-370)', () => {
  it('the password-set flag stores an object, not a boolean', async () => {
    const { storage, records } = setup()
    await records.setup(CHAIN_ID, ACCOUNT).passwordSet.write('password-set')
    expect(storage.raw.size).toBe(1)
    const [stored] = [...storage.raw.values()]
    expect(typeof stored).toBe('object')
    expect(stored).not.toBeNull()
    expect(stored).toEqual({ value: 'password-set', savedAt: T0 })
  })

  it('a waiting period of zero still reads as a stored fact, not as absent', async () => {
    const { records } = setup()
    await records.setup(CHAIN_ID, ACCOUNT).waitingPeriod.write(0n)
    expect(present(await records.setup(CHAIN_ID, ACCOUNT).waitingPeriod.read()).value).toBe(0n)
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

  it('the absent value is itself not false, zero, undefined or null', () => {
    expect(ABSENT).toBeDefined()
    expect(ABSENT).not.toBe(false)
    expect(ABSENT).not.toBe(0)
    expect(ABSENT).not.toBeNull()
    expect(ABSENT.status).toBe('absent')
  })

  it('every value the lane writes is a truthy object', async () => {
    const { storage, records } = setup()
    await writeAllSetup(records)
    await records.setup(CHAIN_ID, OTHER_ACCOUNT).waitingPeriod.write(0n)
    await records.recoverySession(CHAIN_ID).write(SESSION)
    await records.landSubmission(CHAIN_ID, ACCOUNT)
    await records.decryptedSetupCache(CHAIN_ID, ACCOUNT).write(CONFIGURATION)
    await records.recoverySession(1n).write(SESSION)
    await records.wipeRecoverySession(1n, 'deadline-passed')
    expect(storage.raw.size).toBeGreaterThanOrEqual(10)
    storage.raw.forEach((value) => {
      expect(typeof value).toBe('object')
      expect(value).not.toBeNull()
      expect(!value).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// The recovery session
// ---------------------------------------------------------------------------

describe('the recovery session (D-310, I-38)', () => {
  it('round-trips the approvals and the predicted attempt id', async () => {
    const { records } = setup()
    await records.recoverySession(CHAIN_ID).write(SESSION)
    const read = present(await records.recoverySession(CHAIN_ID).read())
    expect(read.savedAt).toBe(T0)
    expect(read.value).toEqual({ state: 'live', ...SESSION })
  })

  it('reads as absent before any write', async () => {
    const { records } = setup()
    expect(await records.recoverySession(CHAIN_ID).read()).toBe(ABSENT)
  })

  it('the wipe vocabulary holds exactly the five events, no sixth', () => {
    expect(RECOVERY_WIPE_EVENTS).toHaveLength(5)
    expect([...RECOVERY_WIPE_EVENTS].sort()).toEqual([...FIVE_EVENTS].sort())
  })
  ;['security-stop', 'securityStop', 'pause', 'cancelled', ''].forEach((event) =>
    it(`refuses '${event}', outside the vocabulary, and wipes nothing`, async () => {
      const { records } = setup()
      await records.recoverySession(CHAIN_ID).write(SESSION)
      await expect(
        records.wipeRecoverySession(CHAIN_ID, event as RecoveryWipeEvent)
      ).rejects.toThrow()
      expect(present(await records.recoverySession(CHAIN_ID).read()).value).toEqual({
        state: 'live',
        ...SESSION
      })
    })
  )

  it('exposes no security-stop wipe (I-38: a security stop wipes nothing)', () => {
    const { records } = setup()
    const names = Object.keys(records)
    expect(names.filter((n) => /stop|pause/i.test(n))).toEqual([])
  })

  FIVE_EVENTS.forEach((event) =>
    describe(`the ${event} event`, () => {
      it('wipes the approvals and the predicted attempt id and keeps exactly its reason', async () => {
        const { storage, records } = setup()
        await records.recoverySession(CHAIN_ID).write(SESSION)
        if (event === 'submission-landed') {
          await records.landSubmission(CHAIN_ID, ACCOUNT)
        } else {
          await records.wipeRecoverySession(CHAIN_ID, event)
        }
        const read = present(await records.recoverySession(CHAIN_ID).read())
        expect(read.value).toEqual({ state: 'wiped', reason: event })
        const text = dump(storage)
        expect(text).not.toContain(SIGNATURE_A)
        expect(text).not.toContain(SIGNATURE_B)
        expect(text).not.toContain(`${PREDICTED_ATTEMPT_ID}n`)
        expect(text).not.toContain('approvals')
        expect(text).not.toContain('predictedAttemptId')
      })
    })
  )

  it('a later wipe keeps only its own reason, one line and not a list', async () => {
    const { records } = setup()
    await records.recoverySession(CHAIN_ID).write(SESSION)
    await records.wipeRecoverySession(CHAIN_ID, 'deadline-passed')
    await records.recoverySession(CHAIN_ID).write(SESSION)
    await records.wipeRecoverySession(CHAIN_ID, 'setup-changed')
    expect(present(await records.recoverySession(CHAIN_ID).read()).value).toEqual({
      state: 'wiped',
      reason: 'setup-changed'
    })
  })

  it('a pause wipes nothing: a later read, even from a new instance, still holds the session', async () => {
    const { storage, records, clock } = setup()
    await records.recoverySession(CHAIN_ID).write(SESSION)
    clock.t = T0 + 10 * HOUR
    // A worker restart: a fresh instance over the same storage.
    const restarted = createWalletRecords({ storage, now: () => clock.t })
    const read = present(await restarted.recoverySession(CHAIN_ID).read())
    expect(read.value).toEqual({ state: 'live', ...SESSION })
    expect(await restarted.recoverySession(CHAIN_ID).age()).toBe(10 * HOUR)
  })

  it('the death states render from the reason alone: expired, void, setup changed (D-392, D-393)', () => {
    expect(WIPE_REASON_STRING_KEYS['deadline-passed']?.title).toMatch(/expired/i)
    expect(WIPE_REASON_STRING_KEYS['another-attempt-opened']?.title).toMatch(/void/i)
    expect(WIPE_REASON_STRING_KEYS['setup-changed']?.title).toMatch(/setupChanged/)
    const records = (en as { socialRecovery: { records: Record<string, string> } }).socialRecovery
      .records
    Object.values(WIPE_REASON_STRING_KEYS).forEach((keys) => {
      if (!keys) return
      ;[keys.title, keys.body].forEach((k) => {
        expect(k.startsWith('socialRecovery.records.')).toBe(true)
        expect(typeof records[k.slice('socialRecovery.records.'.length)]).toBe('string')
      })
    })
  })
})

// ---------------------------------------------------------------------------
// The countdown record
// ---------------------------------------------------------------------------

describe('the countdown record after the submission lands (D-310, D-393)', () => {
  it('holds the account address alone and the session is gone', async () => {
    const { records } = setup()
    await records.recoverySession(CHAIN_ID).write(SESSION)
    await records.landSubmission(CHAIN_ID, ACCOUNT)
    const countdown = present(await records.countdown(CHAIN_ID).read())
    expect(countdown.value).toEqual({ account: ACCOUNT })
    expect(countdown.savedAt).toBe(T0)
    const session = present(await records.recoverySession(CHAIN_ID).read())
    expect(session.value).toEqual({ state: 'wiped', reason: 'submission-landed' })
  })

  FIVE_EVENTS.filter((e) => e !== 'submission-landed').forEach((event) =>
    it(`no countdown record follows ${event}`, async () => {
      const { records } = setup()
      await records.recoverySession(CHAIN_ID).write(SESSION)
      await records.wipeRecoverySession(CHAIN_ID, event)
      expect(await records.countdown(CHAIN_ID).read()).toBe(ABSENT)
    })
  )
})

// ---------------------------------------------------------------------------
// The decrypted setup cache
// ---------------------------------------------------------------------------

describe('the decrypted setup cache after execution (D-310)', () => {
  it('reads as absent before any write', async () => {
    const { records } = setup()
    expect(await records.decryptedSetupCache(CHAIN_ID, ACCOUNT).read()).toBe(ABSENT)
  })

  it('stays through the whole recovery and after it executes', async () => {
    const { records } = setup()
    await records.decryptedSetupCache(CHAIN_ID, ACCOUNT).write(CONFIGURATION)
    await writeAllSetup(records)
    await records.recoverySession(CHAIN_ID).write(SESSION)
    await records.landSubmission(CHAIN_ID, ACCOUNT)
    // Execution: the countdown ends; the setup records of a later save go too.
    await records.countdown(CHAIN_ID).wipe()
    await records.saveSetup(CHAIN_ID, ACCOUNT)
    await records.startOverSetup(CHAIN_ID, ACCOUNT)
    await Promise.all(
      RECOVERY_WIPE_EVENTS.map((event) => records.wipeRecoverySession(CHAIN_ID, event))
    )
    const cache = present(await records.decryptedSetupCache(CHAIN_ID, ACCOUNT).read())
    expect(cache.value).toEqual(CONFIGURATION)
    expect(cache.savedAt).toBe(T0)
  })
})
