/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "chrome-extension://cgjhdpkjghcgpplimocodhjgcceglpoj/tab.html#/social-recovery/ceremony"}
 */
/**
 * PT-041 done entry: every test reports exactly one of four verdicts, passed,
 * failed with its cause, unavailable with retry and not supported without one
 * (ux-interfaces.md D-372, ux-copy.md UXC-13: a failed test reads "test failed"
 * with its cause, never "not tested"). The brief asks this of each host: a
 * method that throws a cause yields failed with that cause, a node or service
 * that does not answer yields unavailable with retry, a method that cannot
 * serve the document yields not supported with no retry. The health-check host
 * is a third-release shell that returns not supported (brief, delta 2).
 */
import { METHOD_CHIPS } from '@web/modules/social-recovery/shared/display'

import {
  enrollFailure,
  fakeAssertion,
  fakeAttestation,
  fakeMethod,
  fakeOrchestrator,
  FOUR_VERDICTS,
  FourVerdict,
  generatePoint,
  HostName,
  hosts,
  installCredentials,
  laneVerdictVocabulary,
  lineKeyOf,
  MethodScript,
  Outcome,
  P256Point,
  replyFailure,
  SYNCED_FLAGS,
  chipOf
} from './harness'

const THROWN_CAUSE = 'the authenticator returned a key of the wrong curve'

/** A node or a service that did not answer: a timeout, and a fetch that never reached it. */
const timedOut = () =>
  Object.assign(new Error('the prover service did not answer in time'), { name: 'TimeoutError' })
const fetchFailed = () => new TypeError('Failed to fetch')

/** A stringify that survives bigints, for the "never not tested" scan. */
const scan = (value: unknown): string => {
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) ?? ''
  } catch {
    return String(value)
  }
}

interface Case {
  title: string
  script: MethodScript
  verdict: FourVerdict
  cause?: string | RegExp
}

// The member each host runs: enroll packages through configFrom, test access
// through replyFrom then verify, create claim through replyFrom.
const CASES: Record<Exclude<HostName, 'healthCheck'>, Case[]> = {
  enroll: [
    { title: 'the method returns a config', script: {}, verdict: 'passed' },
    {
      title: 'the method throws a cause',
      script: { configFrom: { throws: new Error(THROWN_CAUSE) } },
      verdict: 'failed',
      cause: THROWN_CAUSE
    },
    {
      title: 'the method returns its enrollment failure',
      script: { configFrom: enrollFailure('material-rejected') },
      verdict: 'failed',
      cause: 'material-rejected'
    },
    {
      title: 'the device did not answer',
      script: { configFrom: enrollFailure('device-unavailable') },
      verdict: 'unavailable'
    },
    {
      title: 'a service did not answer (timeout)',
      script: { configFrom: { throws: timedOut() } },
      verdict: 'unavailable'
    },
    {
      title: 'a node did not answer (failed fetch)',
      script: { configFrom: { throws: fetchFailed() } },
      verdict: 'unavailable'
    },
    {
      title: 'the method cannot serve it',
      script: { configFrom: enrollFailure('method-unsupported') },
      verdict: 'not-supported'
    },
    {
      title: 'the method cannot read the record version',
      script: { configFrom: enrollFailure('version-unread') },
      verdict: 'not-supported'
    }
  ],
  testAccess: [
    { title: 'the proof satisfies the credential', script: {}, verdict: 'passed' },
    {
      title: 'the method throws a cause',
      script: { replyFrom: { throws: new Error(THROWN_CAUSE) } },
      verdict: 'failed',
      cause: THROWN_CAUSE
    },
    {
      title: 'the method returns its typed failure',
      script: { replyFrom: replyFailure('material-rejected') },
      verdict: 'failed',
      cause: 'material-rejected'
    },
    {
      title: 'the check does not match the key',
      script: { verify: 'rejected' },
      verdict: 'failed',
      cause: /./
    },
    {
      title: 'the verifier could not be reached (not judged)',
      script: { verify: 'not-judged' },
      verdict: 'unavailable'
    },
    {
      title: 'the check could not reach its node (failed fetch)',
      script: { verify: { throws: fetchFailed() } },
      verdict: 'unavailable'
    },
    {
      title: 'the check throws a cause',
      script: { verify: { throws: new Error(THROWN_CAUSE) } },
      verdict: 'failed',
      cause: THROWN_CAUSE
    },
    {
      title: 'the device did not answer',
      script: { replyFrom: replyFailure('device-unavailable') },
      verdict: 'unavailable'
    },
    {
      title: 'a service did not answer (timeout)',
      script: { replyFrom: { throws: timedOut() } },
      verdict: 'unavailable'
    },
    {
      title: 'the method cannot serve it',
      script: { replyFrom: replyFailure('method-unsupported') },
      verdict: 'not-supported'
    }
  ],
  createClaim: [
    { title: 'the method returns a proof', script: {}, verdict: 'passed' },
    {
      title: 'the method throws a cause',
      script: { replyFrom: { throws: new Error(THROWN_CAUSE) } },
      verdict: 'failed',
      cause: THROWN_CAUSE
    },
    {
      title: 'the method returns its typed failure',
      script: { replyFrom: replyFailure('material-rejected') },
      verdict: 'failed',
      cause: 'material-rejected'
    },
    {
      title: 'the device did not answer',
      script: { replyFrom: replyFailure('device-unavailable') },
      verdict: 'unavailable'
    },
    {
      title: 'a service did not answer (timeout)',
      script: { replyFrom: { throws: timedOut() } },
      verdict: 'unavailable'
    },
    {
      title: 'the method cannot serve it',
      script: { replyFrom: replyFailure('method-unsupported') },
      verdict: 'not-supported'
    }
  ]
}

let point: P256Point
let restore: () => void

beforeAll(async () => {
  point = await generatePoint()
})

beforeEach(() => {
  const creds = installCredentials({
    create: async () => fakeAttestation({ flags: SYNCED_FLAGS, point }).credential,
    get: async () => fakeAssertion({ r: BigInt(5), s: BigInt(6) }).credential
  })
  restore = creds.restore
})

afterEach(() => restore())

const expectOneVerdict = (outcome: Outcome, expected: Case) => {
  expect(outcome.type).toBe('verdict')
  if (outcome.type !== 'verdict') return
  expect(outcome.verdict).toBe(expected.verdict)
  // UXC-13: a failed test is never a skipped one, in the result or the row's words.
  expect(scan(outcome.raw)).not.toMatch(/not[\s_-]?tested|skipped/i)
  expect(lineKeyOf(outcome)).not.toBe('socialRecovery.ceremony.notTestedLine')
  expect(chipOf(outcome.verdict)).not.toBe('notTested')
  switch (outcome.verdict) {
    case 'failed':
      expect(lineKeyOf(outcome)).toMatch(/^socialRecovery\.ceremony\.testFailed(Line|NoMatch)$/)
      expect(outcome.cause).toEqual(expect.any(String))
      expect((outcome.cause ?? '').length).toBeGreaterThan(0)
      if (typeof expected.cause === 'string') expect(outcome.cause).toContain(expected.cause)
      else if (expected.cause) expect(outcome.cause).toMatch(expected.cause)
      break
    case 'unavailable':
      expect(outcome.retry).toBe(true)
      expect(lineKeyOf(outcome)).toBe('socialRecovery.ceremony.testUnavailableLine')
      break
    case 'not-supported':
      expect(outcome.retry).toBe(false)
      expect(lineKeyOf(outcome)).toBe('socialRecovery.ceremony.notSupportedLine')
      break
    default:
      break
  }
}

;(Object.keys(CASES) as (keyof typeof CASES)[]).forEach((host) =>
  describe(`the ${host} host`, () => {
    CASES[host].forEach((c) =>
      it(c.title, async () => {
        const method = fakeMethod(c.script)
        const orchestrator = fakeOrchestrator(method)
        const outcome = await hosts[host]({ method, orchestrator })
        expectOneVerdict(outcome, c)
      })
    )

    it('reaches every one of the four verdicts, and no other', () => {
      const reached = new Set(CASES[host].map((c) => c.verdict))
      expect([...reached].sort()).toEqual([...FOUR_VERDICTS].sort())
    })
  })
)

describe('the health-check host (third release, a shell)', () => {
  it('returns not supported with no retry', async () => {
    const method = fakeMethod()
    const orchestrator = fakeOrchestrator(method)
    const outcome = await hosts.healthCheck({ method, orchestrator })
    expect(outcome).toMatchObject({ type: 'verdict', verdict: 'not-supported', retry: false })
  })

  it('runs no member of the method and no ceremony', async () => {
    const creds = installCredentials()
    const method = fakeMethod()
    const orchestrator = fakeOrchestrator(method)
    await hosts.healthCheck({ method, orchestrator })
    const memberCalls = [
      method.enrollInput,
      method.configFrom,
      method.signingInput,
      method.replyFrom,
      method.verify,
      orchestrator.configFrom,
      orchestrator.replyFrom,
      orchestrator.verify
    ].reduce((n, fn) => n + fn.mock.calls.length, 0)
    expect(memberCalls).toBe(0)
    expect(creds.create).not.toHaveBeenCalled()
    expect(creds.get).not.toHaveBeenCalled()
    creds.restore()
  })
})

describe('the verdict vocabulary', () => {
  it('is closed at four verdicts', () => {
    const lane = laneVerdictVocabulary().map(String)
    expect(lane).toHaveLength(4)
    expect(new Set(lane).size).toBe(4)
  })

  it('renders each verdict with its own PT-036 method chip, never not tested', () => {
    const chips = FOUR_VERDICTS.map((v) => chipOf(v))
    expect(chips).toEqual(['tested', 'testFailed', 'testUnavailable', 'notSupported'])
    chips.forEach((chip) => expect(METHOD_CHIPS as readonly string[]).toContain(chip))
    expect(chips).not.toContain('notTested')
  })
})
