/**
 * The external-app device follows a zkPassport request the holder answers on
 * a phone: it opens the request the method's input carries, has the screen
 * draw its link, follows the phone's callbacks as steps, and hands back the
 * verified result at an enrollment and the proofs at a claim. A declined
 * request is the refused note, the phone's error a failure with its message,
 * a request that does not open a device that did not answer, and an abort the
 * cancelled note, after which no callback counts. The request here is a
 * hand-made one whose callbacks the test fires.
 */
import type { EnrollInput, Input } from '@kohaku-eth/social-recovery'

import { externalAppDevice } from '@web/modules/social-recovery/shared/ceremony/externalAppDevice'
import type {
  CeremonyStep,
  CeremonyView,
  DeviceCallContext,
  DeviceResult
} from '@web/modules/social-recovery/shared/ceremony'

const URL = 'https://zkpassport.example/r?id=1'
const OUTER = { name: 'outer_evm_count_4', publicInputs: ['0x0a', '0x00', '0x1c8', '0x00'] }
const INNER = { name: 'disclose_bytes' }
const UNAVAILABLE = {
  kind: 'verdict',
  verdict: 'unavailable',
  retry: true,
  cause: 'device-unavailable'
}
const CANCELLED = {
  ok: false,
  stop: { kind: 'dismissed', note: 'cancelled', detail: 'AbortError' }
}
const REFUSED = { ok: false, stop: { kind: 'dismissed', note: 'refused' } }

type Callback = (...args: unknown[]) => unknown

/** A request whose callbacks the test fires; `onResult` only where the library offers it. */
const phoneRequest = ({ withResult = true }: { withResult?: boolean } = {}) => {
  const handlers = new Map<string, Callback[]>()
  const on = (name: string) => (callback: Callback) => {
    handlers.set(name, [...(handlers.get(name) ?? []), callback])
  }
  const request = {
    url: URL,
    requestId: 'request-1',
    onRequestReceived: on('received'),
    onGeneratingProof: on('generating'),
    onProofGenerated: on('generated'),
    onSuccess: on('success'),
    onReject: on('reject'),
    onError: on('error'),
    ...(withResult ? { onResult: on('result') } : {})
  }
  const fire = (name: string, ...args: unknown[]) =>
    (handlers.get(name) ?? []).forEach((callback) => callback(...args))
  return { request, fire, listening: (name: string) => (handlers.get(name) ?? []).length }
}

const inputOf = (openRequest: () => unknown) =>
  ({ kind: 'ceremony', domain: 'kohaku.example', scope: 'recovery', openRequest } as EnrollInput &
    Input)

const tick = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0)
  })

interface Watched {
  context: DeviceCallContext
  steps: CeremonyStep[]
  views: CeremonyView[]
}

const watched = (extra: Partial<DeviceCallContext> = {}): Watched => {
  const steps: CeremonyStep[] = []
  const views: CeremonyView[] = []
  return {
    steps,
    views,
    context: {
      onStep: (step) => steps.push(step),
      show: (view) => views.push(view),
      ...extra
    }
  }
}

/** Starts one device call over `phone` and resolves once the device listens. */
const start = async (
  call: 'enroll' | 'sign',
  phone: ReturnType<typeof phoneRequest>,
  extra: Partial<DeviceCallContext> = {}
) => {
  const open = jest.fn(async () => phone.request)
  const watch = watched(extra)
  let outcome: DeviceResult | undefined
  const running = externalAppDevice()
    [call](inputOf(open), watch.context)
    .then((result) => {
      outcome = result
      return result
    })
  await tick()
  return { ...watch, open, running, outcome: () => outcome }
}

describe('the external-app device at an enrollment', () => {
  it('opens the request once, shows its link and waits for the phone', async () => {
    const phone = phoneRequest()
    const run = await start('enroll', phone)
    expect(run.open).toHaveBeenCalledTimes(1)
    expect(run.views).toEqual([{ kind: 'scanCode', url: URL }])
    expect(run.steps).toEqual(['waitingForPhone'])
    expect(run.outcome()).toBeUndefined()
  })

  it("follows the phone's callbacks as steps and hands back the result callback's payload", async () => {
    const phone = phoneRequest()
    const run = await start('enroll', phone)
    phone.fire('received')
    phone.fire('generating')
    phone.fire('generated', OUTER)
    expect(run.steps).toEqual([
      'waitingForPhone',
      'requestReceived',
      'generating',
      'resultReceived'
    ])
    expect(run.outcome()).toBeUndefined()

    const payload = { verified: true, uniqueIdentifier: '456', proofs: [INNER, OUTER] }
    phone.fire('success', { proofs: [INNER, OUTER], result: {} })
    phone.fire('result', payload)
    await expect(run.running).resolves.toEqual({ ok: true, material: { result: payload } })
  })

  it('reads a result callback payload that is no record as a device that did not answer', async () => {
    const phone = phoneRequest()
    const run = await start('enroll', phone)
    phone.fire('result', 'verified')
    await expect(run.running).resolves.toEqual({ ok: false, stop: UNAVAILABLE })
  })

  it("builds the verified result from the success callback's outer proof where the library offers no result callback", async () => {
    const phone = phoneRequest({ withResult: false })
    const run = await start('enroll', phone)
    phone.fire('success', { proofs: [INNER, OUTER], result: {} })
    await expect(run.running).resolves.toEqual({
      ok: true,
      material: { result: { verified: true, uniqueIdentifier: '456', proofs: [INNER, OUTER] } }
    })
  })

  const UNREADABLE: [string, unknown[]][] = [
    ['no outer proof', [INNER]],
    ['an outer proof with no public inputs', [{ name: 'outer_evm_count_4' }]],
    [
      'an outer proof whose identifier is no number',
      [{ ...OUTER, publicInputs: ['0x0a', 'x', '0'] }]
    ],
    ['no proofs at all', []]
  ]
  UNREADABLE.forEach(([what, proofs]) =>
    it(`reads ${what} from a library with no result callback as a device that did not answer`, async () => {
      const phone = phoneRequest({ withResult: false })
      const run = await start('enroll', phone)
      phone.fire('success', { proofs, result: {} })
      await expect(run.running).resolves.toEqual({ ok: false, stop: UNAVAILABLE })
    })
  )
})

describe('the external-app device at a claim', () => {
  it('hands back the proofs the success callback delivers', async () => {
    const phone = phoneRequest()
    const run = await start('sign', phone)
    expect(run.views).toEqual([{ kind: 'scanCode', url: URL }])
    phone.fire('generated', OUTER)
    phone.fire('success', { proofs: [INNER, OUTER], result: {} })
    await expect(run.running).resolves.toEqual({ ok: true, material: { proofs: [INNER, OUTER] } })
  })

  it('hands back the proofs the phone generated where the success callback delivers none', async () => {
    const phone = phoneRequest()
    const run = await start('sign', phone)
    phone.fire('generated', INNER)
    phone.fire('generated', OUTER)
    phone.fire('success', { proofs: [], result: {} })
    await expect(run.running).resolves.toEqual({ ok: true, material: { proofs: [INNER, OUTER] } })
  })

  it('never settles on the result callback, which carries no claim', async () => {
    const phone = phoneRequest()
    const run = await start('sign', phone)
    phone.fire('result', { verified: true, uniqueIdentifier: '456', proofs: [OUTER] })
    await tick()
    expect(run.outcome()).toBeUndefined()
  })
})
;(['enroll', 'sign'] as const).forEach((call) =>
  describe(`the external-app device's stops at ${call}`, () => {
    it('reads a declined request as the refused note', async () => {
      const phone = phoneRequest()
      const run = await start(call, phone)
      phone.fire('received')
      phone.fire('reject')
      await expect(run.running).resolves.toEqual(REFUSED)
    })

    it("reads the phone's error as failed with its message, and retry", async () => {
      const phone = phoneRequest()
      const run = await start(call, phone)
      phone.fire('error', 'The chip did not answer.')
      await expect(run.running).resolves.toEqual({
        ok: false,
        stop: {
          kind: 'verdict',
          verdict: 'failed',
          retry: true,
          cause: 'phone-error',
          detail: 'The chip did not answer.'
        }
      })
    })

    it('reads an abort while the phone works as cancelled, and honours no callback after it', async () => {
      const controller = new AbortController()
      const phone = phoneRequest()
      const run = await start(call, phone, { signal: controller.signal })
      phone.fire('received')
      controller.abort()
      phone.fire('generating')
      phone.fire('generated', OUTER)
      phone.fire('success', { proofs: [OUTER], result: {} })
      phone.fire('result', { verified: true, uniqueIdentifier: '456', proofs: [OUTER] })
      await expect(run.running).resolves.toEqual(CANCELLED)
      expect(run.steps).toEqual(['waitingForPhone', 'requestReceived'])
    })

    it('keeps the first answer: a callback after the phone answered changes nothing', async () => {
      const phone = phoneRequest()
      const run = await start(call, phone)
      phone.fire('reject')
      phone.fire('error', 'late')
      phone.fire('success', { proofs: [OUTER], result: {} })
      await expect(run.running).resolves.toEqual(REFUSED)
    })

    it('opens nothing for an already aborted signal', async () => {
      const controller = new AbortController()
      controller.abort()
      const open = jest.fn(async () => phoneRequest().request)
      await expect(
        externalAppDevice()[call](inputOf(open), { signal: controller.signal })
      ).resolves.toEqual(CANCELLED)
      expect(open).not.toHaveBeenCalled()
    })

    it('reads an abort while the request opens as cancelled, and shows nothing', async () => {
      const controller = new AbortController()
      const phone = phoneRequest()
      let opened: () => void = () => undefined
      const open = () =>
        new Promise((resolve) => {
          opened = () => resolve(phone.request)
        })
      const watch = watched({ signal: controller.signal })
      const running = externalAppDevice()[call](inputOf(open), watch.context)
      await tick()
      controller.abort()
      opened()
      await expect(running).resolves.toEqual(CANCELLED)
      expect(watch.views).toEqual([])
      expect(phone.listening('success')).toBe(0)
    })

    const UNOPENED: [string, EnrollInput & Input][] = [
      ['carries no opener', { kind: 'ceremony' } as EnrollInput & Input],
      [
        'has an opener that throws',
        inputOf(() => {
          throw new Error('no phone')
        })
      ],
      ['has an opener that rejects', inputOf(async () => Promise.reject(new Error('no network')))],
      ['opens no request', inputOf(async () => ({ url: URL }))],
      ['opens a request with no link', inputOf(async () => ({ ...phoneRequest().request, url: 1 }))]
    ]
    UNOPENED.forEach(([what, input]) =>
      it(`reads an input that ${what} as a device that did not answer, with retry`, async () => {
        const watch = watched()
        await expect(externalAppDevice()[call](input, watch.context)).resolves.toEqual({
          ok: false,
          stop: UNAVAILABLE
        })
        expect(watch.views).toEqual([])
      })
    )

    it('runs on a screen that draws nothing', async () => {
      const phone = phoneRequest()
      const open = jest.fn(async () => phone.request)
      const running = externalAppDevice()[call](inputOf(open), {})
      await tick()
      phone.fire('reject')
      await expect(running).resolves.toEqual(REFUSED)
    })
  })
)
