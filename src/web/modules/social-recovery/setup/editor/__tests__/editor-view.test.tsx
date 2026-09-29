/**
 * @jest-environment jsdom
 *
 * The editor mounted over the setup records on an in-memory storage, with a
 * fake path check. Every edit writes the draft and the path together, a
 * credential the path already holds is refused before anything is written,
 * the rule lines are the rule-lines lane's for the path as it stands, and
 * continue opens the waiting period only when the path check finds no error.
 *
 * jsdom has no `TextEncoder`, which viem needs when its modules load, so the
 * test sets Node's first and loads the modules after it.
 */
import { TextDecoder, TextEncoder } from 'util'

import type {
  Clause,
  Finding,
  SetupDraft,
  ValidationResult
} from '@web/modules/social-recovery/sdk-interfaces'
import type { Enrollment } from '@web/modules/social-recovery/shared/records'

Object.assign(globalThis, { TextEncoder, TextDecoder })

// React only runs effects and state updates inside act() when this flag is set.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const React = jest.requireActual<typeof import('react')>('react')
const { createRoot } = jest.requireActual<typeof import('react-dom/client')>('react-dom/client')
const { act } = jest.requireActual<typeof import('react-dom/test-utils')>('react-dom/test-utils')
const { t } = jest.requireActual<typeof import('@common/config/localization')>(
  '@common/config/localization'
).default
const en = jest.requireActual<typeof import('@common/config/localization/translations/en.json')>(
  '@common/config/localization/translations/en.json'
)
const { WEB_ROUTES } = jest.requireActual<typeof import('@common/modules/router/constants/common')>(
  '@common/modules/router/constants/common'
)
const { getRuleLines, renderRuleLines } = jest.requireActual<
  typeof import('@web/modules/social-recovery/shared/rule-lines')
>('@web/modules/social-recovery/shared/rule-lines')
const EditorView = jest.requireActual<typeof import('../EditorView')>('../EditorView').default
const { emptySlotOf } = jest.requireActual<typeof import('../operations')>('../operations')
const harness = jest.requireActual<typeof import('./harness')>('./harness')
const {
  ALICE,
  BOB,
  BOOK,
  CAROL,
  enrolled,
  makeRecords,
  PASSKEY,
  PASSPORT,
  presetPath,
  twoGroupPath
} = harness

type Root = ReturnType<typeof createRoot>
type Validate = (draft: SetupDraft) => Promise<ValidationResult>

const draftOf = (clauses: Clause[]): SetupDraft => ({
  wait: 259200n,
  clauses,
  ignoresPause: false,
  privacy: { publicMetadata: '0x', backup: 'encrypted' }
})

const NO_FINDING: ValidationResult = { errors: [], warnings: [] }
const finding = (code: Finding['code']): Finding => ({ code, subject: 'clause', values: {} })

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

/**
 * Lets the pending storage reads and writes settle, then renders what they
 * changed. The storage double answers in microtasks, which all run before a
 * timer fires.
 */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  })

const byTestId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const allByTestId = (id: string) =>
  Array.from(
    container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
    (node) => node.textContent
  )

const press = async (id: string) => {
  const node = byTestId(id)
  if (!node) throw new Error(`nothing on screen with the test id ${id}`)
  act(() => node.click())
  await settle()
}

interface MountOptions {
  clauses?: Clause[]
  enrollments?: Enrollment[]
  validate?: Validate
  client?: 'loading' | 'refused'
  retry?: () => void
}

const mount = async ({
  clauses,
  enrollments = [],
  validate = async () => NO_FINDING,
  client,
  retry = () => {}
}: MountOptions = {}) => {
  const { storage, records } = makeRecords()
  if (clauses) {
    await records.setupDraft.write(draftOf(clauses))
    await records.path.write(clauses)
  }
  if (enrollments.length > 0) await records.enrollments.write(enrollments)
  const validateSetup = jest.fn(validate)
  const navigate = jest.fn()
  const editorClient =
    client === 'loading'
      ? ({ status: 'loading' } as const)
      : client === 'refused'
      ? ({ status: 'failed', retry } as const)
      : ({ status: 'ready', setup: { validateSetup } } as const)
  await act(async () => {
    root.render(
      <EditorView records={records} client={editorClient} addressBook={BOOK} navigate={navigate} />
    )
  })
  await settle()
  const writesBefore = storage.sets.length
  const stored = async () => {
    const [draft, path] = await Promise.all([records.setupDraft.read(), records.path.read()])
    return {
      draft: draft.status === 'present' ? draft.value : null,
      path: path.status === 'present' ? path.value : null
    }
  }
  return { storage, records, validateSetup, navigate, stored, writesBefore }
}

const expectPathMatchesDraft = async (
  stored: () => Promise<{ draft: SetupDraft | null; path: Clause[] | null }>,
  clauses: Clause[]
) => {
  const { draft, path } = await stored()
  expect(draft?.clauses).toEqual(clauses)
  expect(path).toEqual(clauses)
}

describe('the editor on arrival', () => {
  it('reads "Adjust your path" over a stored preset', async () => {
    await mount({ clauses: presetPath() })
    expect(byTestId('editor-title')?.textContent).toBe(en.socialRecovery.editor.adjust.title)
  })

  it('reads "Build your path" over no draft, and over a draft with no clause', async () => {
    await mount()
    expect(byTestId('editor-title')?.textContent).toBe(en.socialRecovery.editor.build.title)
    act(() => root.unmount())
    root = createRoot(container)
    await mount({ clauses: [] })
    expect(byTestId('editor-title')?.textContent).toBe(en.socialRecovery.editor.build.title)
  })

  it('draws an empty slot as a row of its kind with the "Not yet active" chip and no address', async () => {
    await mount({ clauses: [{ threshold: 2, credentials: [emptySlotOf('ecdsa'), ALICE] }] })
    const slot = byTestId('editor-slot-0-0')?.textContent ?? ''
    expect(slot).toContain(en.socialRecovery.display.nouns.guardian)
    expect(slot).toContain(en.socialRecovery.status.method.notYetActive)
    expect(slot).not.toMatch(/0x/)
  })

  it('goes back to the setup start', async () => {
    const { navigate } = await mount({ clauses: presetPath() })
    await press('editor-back')
    expect(navigate).toHaveBeenCalledWith(WEB_ROUTES.socialRecoverySetup)
  })
})

describe('every edit on screen', () => {
  it("writes the draft and the path together, the path equal to the draft's clauses", async () => {
    const { stored } = await mount({
      clauses: twoGroupPath(),
      enrollments: [PASSKEY, ALICE, BOB, CAROL, PASSPORT].map(enrolled)
    })

    await press('editor-member-1-0-required')
    await expectPathMatchesDraft(stored, [
      { threshold: 1, credentials: [PASSKEY] },
      { threshold: 2, credentials: [BOB] },
      { threshold: 1, credentials: [CAROL, PASSPORT] },
      { threshold: 1, credentials: [ALICE] }
    ])

    await press('editor-member-2-1-remove')
    await expectPathMatchesDraft(stored, [
      { threshold: 1, credentials: [PASSKEY] },
      { threshold: 2, credentials: [BOB] },
      { threshold: 1, credentials: [CAROL] },
      { threshold: 1, credentials: [ALICE] }
    ])

    await press('editor-add-group')
    await expectPathMatchesDraft(stored, [
      { threshold: 1, credentials: [PASSKEY] },
      { threshold: 2, credentials: [BOB] },
      { threshold: 1, credentials: [CAROL] },
      { threshold: 1, credentials: [ALICE] },
      { threshold: 2, credentials: [] }
    ])

    await press('editor-group-1-remove')
    await expectPathMatchesDraft(stored, [
      { threshold: 1, credentials: [PASSKEY] },
      { threshold: 1, credentials: [CAROL] },
      { threshold: 1, credentials: [ALICE] },
      { threshold: 2, credentials: [] }
    ])

    await press('editor-row-0-remove')
    await expectPathMatchesDraft(stored, [
      { threshold: 1, credentials: [CAROL] },
      { threshold: 1, credentials: [ALICE] },
      { threshold: 2, credentials: [] }
    ])
  })

  it('moves a required row into the one group with one press, the credential kept', async () => {
    const { stored } = await mount({ clauses: presetPath() })
    await press('editor-row-0-move')
    await expectPathMatchesDraft(stored, [
      { threshold: 2, credentials: [ALICE, BOB, PASSPORT, PASSKEY] }
    ])
  })

  it('asks which group a row moves to when the path has two', async () => {
    const { stored } = await mount({ clauses: twoGroupPath() })
    await press('editor-row-0-move')
    expect(await stored()).toEqual({ draft: draftOf(twoGroupPath()), path: twoGroupPath() })
    await press('editor-row-0-move-2')
    await expectPathMatchesDraft(stored, [
      { threshold: 2, credentials: [ALICE, BOB] },
      { threshold: 1, credentials: [CAROL, PASSPORT, PASSKEY] }
    ])
  })

  it('writes a typed threshold to the group', async () => {
    const { stored } = await mount({ clauses: presetPath() })
    const input = byTestId('editor-group-1-threshold') as HTMLInputElement
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    act(() => {
      setValue?.call(input, '3')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await settle()
    await expectPathMatchesDraft(stored, [
      { threshold: 1, credentials: [PASSKEY] },
      { threshold: 3, credentials: [ALICE, BOB, PASSPORT] }
    ])
  })

  it("adds a picked enrollment as a member, and keeps the draft's other fields", async () => {
    const { stored } = await mount({
      clauses: presetPath(),
      enrollments: [ALICE, CAROL].map(enrolled)
    })
    await press('editor-group-1-add')
    expect(byTestId('editor-picker')).not.toBeNull()
    await press('editor-picker-ecdsa-1')
    const { draft } = await stored()
    expect(draft).toEqual(
      draftOf([
        { threshold: 1, credentials: [PASSKEY] },
        { threshold: 2, credentials: [ALICE, BOB, PASSPORT, CAROL] }
      ])
    )
    expect(byTestId('editor-picker')).toBeNull()
  })
})

describe('the duplicate refusal on screen', () => {
  it("refuses a group member picked as a required row with the wallet's sentence and writes nothing", async () => {
    const { storage, stored, writesBefore } = await mount({
      clauses: presetPath(),
      enrollments: [ALICE, CAROL].map(enrolled)
    })
    await press('editor-add-required')
    const picker = byTestId('editor-picker-ecdsa')?.textContent ?? ''
    expect(picker).toContain(en.socialRecovery.editor.picker.alreadyInPath)
    await press('editor-picker-ecdsa-0')
    expect(byTestId('editor-refusal')?.textContent).toBe(en.socialRecovery.editor.duplicate)
    expect(storage.sets.length).toBe(writesBefore)
    expect(await stored()).toEqual({ draft: draftOf(presetPath()), path: presetPath() })
  })

  it('refuses a member added twice to one group, and the next edit clears the sentence', async () => {
    const { storage, writesBefore, stored } = await mount({
      clauses: presetPath(),
      enrollments: [ALICE].map(enrolled)
    })
    await press('editor-group-1-add')
    await press('editor-picker-ecdsa-0')
    expect(byTestId('editor-refusal')?.textContent).toBe(en.socialRecovery.editor.duplicate)
    expect(storage.sets.length).toBe(writesBefore)
    await press('editor-add-group')
    expect(byTestId('editor-refusal')).toBeNull()
    await expectPathMatchesDraft(stored, [...presetPath(), { threshold: 2, credentials: [] }])
  })
})

describe('the rule lines on screen', () => {
  const shown = () => allByTestId('editor-rule-line')
  const expected = (clauses: Clause[]) => renderRuleLines(getRuleLines(clauses), t)

  it("equal the rule-lines lane's for a preset shape", async () => {
    await mount({ clauses: presetPath() })
    expect(shown()).toEqual(expected(presetPath()))
    expect(shown().length).toBeGreaterThan(0)
  })

  it("equal the lane's for a one-method path, with the offer of a second method", async () => {
    const clauses = [{ threshold: 1, credentials: [PASSKEY] }]
    const { navigate } = await mount({ clauses })
    expect(shown()).toEqual(expected(clauses))
    expect(shown()).toContain(en.socialRecovery.ruleLines.singleMethod)
    await press('editor-add-second-method')
    expect(byTestId('editor-picker')).not.toBeNull()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('equal the lane\'s for two required rows, with the sizing line and "Make it a group"', async () => {
    const clauses = [
      { threshold: 1, credentials: [PASSKEY] },
      { threshold: 1, credentials: [ALICE] }
    ]
    const { stored } = await mount({ clauses })
    expect(shown()).toEqual(expected(clauses))
    expect(byTestId('editor-make-it-a-group')?.textContent).toBe(
      en.socialRecovery.editor.makeItAGroup
    )
    await press('editor-make-it-a-group')
    const grouped = [{ threshold: 1, credentials: [PASSKEY, ALICE] }]
    await expectPathMatchesDraft(stored, grouped)
    expect(shown()).toEqual(expected(grouped))
    expect(byTestId('editor-make-it-a-group')).toBeNull()
  })

  it("equal the lane's for a path of one empty slot, which counts as its one method", async () => {
    const clauses = [{ threshold: 1, credentials: [emptySlotOf('passkey')] }]
    await mount({ clauses })
    expect(shown()).toEqual(expected(clauses))
    expect(shown()).toContain(en.socialRecovery.ruleLines.singleMethod)
  })

  it('follow the path as it changes', async () => {
    await mount({ clauses: presetPath() })
    await press('editor-member-1-2-remove')
    const next = [
      { threshold: 1, credentials: [PASSKEY] },
      { threshold: 2, credentials: [ALICE, BOB] }
    ]
    expect(shown()).toEqual(expected(next))
    expect(shown()).not.toEqual(expected(presetPath()))
  })
})

describe('enrolling something new from the picker', () => {
  it('adds an empty guardian slot for "New address" and opens the enroll screen at that slot', async () => {
    const { navigate, stored } = await mount({ clauses: presetPath() })
    await press('editor-group-1-add')
    expect(byTestId('editor-picker-ecdsa-new')?.textContent).toBe(
      en.socialRecovery.editor.picker.newAddress
    )
    await press('editor-picker-ecdsa-new')
    await expectPathMatchesDraft(stored, [
      { threshold: 1, credentials: [PASSKEY] },
      { threshold: 2, credentials: [ALICE, BOB, PASSPORT, emptySlotOf('ecdsa')] }
    ])
    expect(navigate).toHaveBeenCalledTimes(1)
    const [to] = navigate.mock.calls[0]
    const [route, search] = to.split('?')
    expect(route).toBe(WEB_ROUTES.socialRecoverySetupEnroll)
    expect(Object.fromEntries(new URLSearchParams(search))).toEqual({
      kind: 'ecdsa',
      clause: '1',
      member: '3'
    })
  })

  it('adds an empty required row for "Enroll something new" and opens the enroll screen at it', async () => {
    const { navigate, stored } = await mount({ clauses: presetPath() })
    await press('editor-add-required')
    expect(byTestId('editor-picker-passkey-new')?.textContent).toBe(
      en.socialRecovery.editor.picker.enrollNew
    )
    await press('editor-picker-passkey-new')
    await expectPathMatchesDraft(stored, [
      ...presetPath(),
      { threshold: 1, credentials: [emptySlotOf('passkey')] }
    ])
    const [to] = navigate.mock.calls[0]
    expect(Object.fromEntries(new URLSearchParams(to.split('?')[1]))).toEqual({
      kind: 'passkey',
      clause: '2',
      member: '0'
    })
  })

  it('opens the enroll screen at an empty slot pressed in the path, offering only its kind, and writes nothing', async () => {
    const clauses = [{ threshold: 2, credentials: [ALICE, emptySlotOf('zkpassport')] }]
    const { navigate, storage, writesBefore } = await mount({ clauses })
    await press('editor-slot-0-1')
    expect(byTestId('editor-picker-zkpassport')).not.toBeNull()
    expect(byTestId('editor-picker-ecdsa')).toBeNull()
    await press('editor-picker-zkpassport-new')
    expect(storage.sets.length).toBe(writesBefore)
    const [to] = navigate.mock.calls[0]
    expect(to).toBe(`${WEB_ROUTES.socialRecoverySetupEnroll}?kind=zkpassport&clause=0&member=1`)
  })
})

describe('continue', () => {
  it('is disabled on an empty path and runs no path check', async () => {
    const { validateSetup, navigate } = await mount()
    expect(byTestId('editor-continue')?.getAttribute('aria-disabled')).toBe('true')
    await press('editor-continue')
    expect(validateSetup).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('checks the stored draft and opens the waiting period when the check finds no error, writing nothing', async () => {
    const { validateSetup, navigate, storage, writesBefore } = await mount({
      clauses: presetPath()
    })
    await press('editor-continue')
    expect(validateSetup).toHaveBeenCalledWith(draftOf(presetPath()))
    expect(navigate).toHaveBeenCalledWith(WEB_ROUTES.socialRecoverySetupWaitingPeriod)
    expect(storage.sets.length).toBe(writesBefore)
  })

  it('checks the draft as edited, once its write has landed', async () => {
    const { validateSetup, stored } = await mount({ clauses: presetPath() })
    await press('editor-member-1-2-remove')
    await press('editor-continue')
    const { draft } = await stored()
    expect(validateSetup).toHaveBeenCalledWith(draft)
    expect(draft?.clauses).toEqual([
      { threshold: 1, credentials: [PASSKEY] },
      { threshold: 2, credentials: [ALICE, BOB] }
    ])
  })

  it('stays and renders each error finding when the check finds one', async () => {
    const { navigate } = await mount({
      clauses: presetPath(),
      validate: async () => ({
        errors: [finding('clause.empty'), finding('action.unsupported')],
        warnings: []
      })
    })
    await press('editor-continue')
    expect(navigate).not.toHaveBeenCalled()
    expect(allByTestId('editor-finding')).toEqual([
      en.socialRecovery.editor.refusals.emptyGroup,
      'action.unsupported'
    ])
    expect(byTestId('editor-continue')).not.toBeNull()
  })

  it('goes on past warnings alone and renders none of them', async () => {
    const { navigate } = await mount({
      clauses: presetPath(),
      validate: async () => ({ errors: [], warnings: [finding('clause.shared-failure')] })
    })
    await press('editor-continue')
    expect(navigate).toHaveBeenCalledWith(WEB_ROUTES.socialRecoverySetupWaitingPeriod)
    expect(allByTestId('editor-finding')).toEqual([])
  })

  it('shows a spinner and no continue while the client loads', async () => {
    await mount({ clauses: presetPath(), client: 'loading' })
    expect(byTestId('editor-continue')).toBeNull()
    expect(byTestId('editor-spinner')).not.toBeNull()
  })

  it('offers a retry and no continue when the client is refused', async () => {
    const retry = jest.fn()
    await mount({ clauses: presetPath(), client: 'refused', retry })
    expect(byTestId('editor-continue')).toBeNull()
    await press('editor-client-retry')
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
