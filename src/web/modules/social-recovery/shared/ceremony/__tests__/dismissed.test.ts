/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "chrome-extension://cgjhdpkjghcgpplimocodhjgcceglpoj/tab.html#/social-recovery/ceremony"}
 */
/**
 * PT-041 done entry: a ceremony the holder dismissed or the browser refused
 * returns before the method runs, as its own note (ux-interfaces.md D-372: the
 * extension reads that one case from the browser's own error). The brief: a
 * `NotAllowedError` before the method runs yields the cancelled or refused note
 * and the method's call count is zero.
 */
import {
  fakeMethod,
  fakeOrchestrator,
  generatePoint,
  HostName,
  hosts,
  installCredentials,
  methodRunCount,
  notAllowedError,
  P256Point,
  fakeAttestation,
  fakeAssertion,
  SYNCED_FLAGS
} from './harness'

// The hosts that run a ceremony: create at enrollment, get at a test and a claim.
const CEREMONY_HOSTS: { host: Exclude<HostName, 'healthCheck'>; call: 'create' | 'get' }[] = [
  { host: 'enroll', call: 'create' },
  { host: 'testAccess', call: 'get' },
  { host: 'createClaim', call: 'get' }
]

let point: P256Point

beforeAll(async () => {
  point = await generatePoint()
})

CEREMONY_HOSTS.forEach(({ host, call }) =>
  describe(`the ${host} host, ${call} rejects with NotAllowedError`, () => {
    let creds: ReturnType<typeof installCredentials>

    beforeEach(() => {
      creds = installCredentials({
        create: async () => {
          if (call === 'create') throw notAllowedError()
          return fakeAttestation({ flags: SYNCED_FLAGS, point }).credential
        },
        get: async () => {
          if (call === 'get') throw notAllowedError()
          return fakeAssertion({ r: BigInt(5), s: BigInt(6) }).credential
        }
      })
    })

    afterEach(() => creds.restore())

    it('returns the cancelled or refused note', async () => {
      const method = fakeMethod()
      const orchestrator = fakeOrchestrator(method)
      const outcome = await hosts[host]({ method, orchestrator })
      expect(outcome.type).toBe('note')
      if (outcome.type === 'note') expect(['cancelled', 'refused']).toContain(outcome.note)
    })

    it('ran the ceremony once and the method zero times', async () => {
      const method = fakeMethod()
      const orchestrator = fakeOrchestrator(method)
      await hosts[host]({ method, orchestrator })
      expect(creds[call]).toHaveBeenCalledTimes(1)
      expect(methodRunCount(method, orchestrator)).toBe(0)
    })

    it('never reads the dismissal as a failed test', async () => {
      const method = fakeMethod()
      const orchestrator = fakeOrchestrator(method)
      const outcome = await hosts[host]({ method, orchestrator })
      expect(outcome).not.toMatchObject({ type: 'verdict' })
    })
  })
)

describe('a ceremony that completes', () => {
  let creds: ReturnType<typeof installCredentials>

  beforeEach(() => {
    creds = installCredentials({
      create: async () => fakeAttestation({ flags: SYNCED_FLAGS, point }).credential,
      get: async () => fakeAssertion({ r: BigInt(5), s: BigInt(6) }).credential
    })
  })

  afterEach(() => creds.restore())

  // The control of the tests above: the same fakes run the method once the
  // browser answers, so a zero count above is the dismissal's doing.
  CEREMONY_HOSTS.forEach(({ host, call }) =>
    it(`the ${host} host calls ${call} and then the method`, async () => {
      const method = fakeMethod()
      const orchestrator = fakeOrchestrator(method)
      await hosts[host]({ method, orchestrator })
      expect(creds[call]).toHaveBeenCalledTimes(1)
      expect(methodRunCount(method, orchestrator)).toBeGreaterThan(0)
    })
  )
})
