/**
 * @jest-environment jsdom
 *
 * The editor's own refusals at continue and its rules panel, mounted over the
 * setup records on an in-memory storage with a fake path check. A shape this
 * wallet refuses stays on screen named in the wallet's words and never
 * reaches the path check; an edit clears it; a path with no refusal goes to
 * the path check. The rules panel is always there, the same nine lines.
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

Object.assign(globalThis, { TextEncoder, TextDecoder })

// React only runs effects and state updates inside act() when this flag is set.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const React = jest.requireActual<typeof import('react')>('react')
const { createRoot } = jest.requireActual<typeof import('react-dom/client')>('react-dom/client')
const { act } = jest.requireActual<typeof import('react-dom/test-utils')>('react-dom/test-utils')
const en = jest.requireActual<typeof import('@common/config/localization/translations/en.json')>(
  '@common/config/localization/translations/en.json'
)
const { WEB_ROUTES } = jest.requireActual<typeof import('@common/modules/router/constants/common')>(
  '@common/modules/router/constants/common'
)
const EditorView = jest.requireActual<
  typeof import('@web/modules/social-recovery/setup/editor/EditorView')
>('@web/modules/social-recovery/setup/editor/EditorView').default
const { emptySlotOf } = jest.requireActual<
  typeof import('@web/modules/social-recovery/setup/editor/operations')
>('@web/modules/social-recovery/setup/editor/operations')
const { AADHAAR, ALICE, BOOK, makeRecords, PASSKEY, presetPath } =
  jest.requireActual<typeof import('./harness')>('./harness')

type Root = ReturnType<typeof createRoot>
type Validate = (draft: SetupDraft) => Promise<ValidationResult>

const { refusals, rules } = en.socialRecovery.editor

/** Two to the 48 seconds, the first wait a 48-bit field cannot hold. */
const TWO_TO_THE_48 = 281474976710656n

const draftOf = (clauses: Clause[], wait = 259200n): SetupDraft => ({
  wait,
  clauses,
  ignoresPause: false,
  privacy: { publicMetadata: '0x', backup: 'encrypted' }
})

const NO_FINDING: ValidationResult = { errors: [], warnings: [] }
const finding = (code: Finding['code']): Finding => ({ code, subject: 'setup', values: {} })

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

const typeThreshold = async (id: string, value: string) => {
  const input = byTestId(id) as HTMLInputElement
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setValue?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await settle()
}

const mount = async ({
  clauses,
  wait,
  validate = async () => NO_FINDING
}: { clauses?: Clause[]; wait?: bigint; validate?: Validate } = {}) => {
  const { records } = makeRecords()
  if (clauses) {
    await records.setupDraft.write(draftOf(clauses, wait))
    await records.path.write(clauses)
  }
  const validateSetup = jest.fn(validate)
  const navigate = jest.fn()
  await act(async () => {
    root.render(
      <EditorView
        records={records}
        client={{ status: 'ready', setup: { validateSetup } }}
        addressBook={BOOK}
        navigate={navigate}
      />
    )
  })
  await settle()
  return { validateSetup, navigate }
}

const PANEL = [
  rules.requiredAnswers,
  rules.enoughMembers,
  rules.thresholdAtLeastOne,
  rules.thresholdCeiling,
  rules.memberCeiling,
  rules.oneRowPerMethod,
  rules.atLeastOneMethod,
  rules.smallEnough,
  rules.zeroThresholdOwnRule
]

describe('continue with a shape this wallet refuses', () => {
  it('renders the refusal, stays, and never runs the path check', async () => {
    const { validateSetup, navigate } = await mount({ clauses: presetPath() })
    await typeThreshold('editor-group-1-threshold', '4')
    await press('editor-continue')
    expect(allByTestId('editor-wallet-refusal')).toEqual([refusals.thresholdAboveMembers])
    expect(validateSetup).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
    expect(byTestId('editor-findings')).toBeNull()
  })

  it('renders one line per refusal, in the order the path reads', async () => {
    const { validateSetup } = await mount({
      clauses: [
        { threshold: 0, credentials: [] },
        { threshold: 4, credentials: [ALICE, AADHAAR] }
      ]
    })
    await press('editor-continue')
    expect(allByTestId('editor-wallet-refusal')).toEqual([
      refusals.emptyGroup,
      refusals.thresholdBelowOneOwnRule,
      refusals.thresholdAboveMembers
    ])
    expect(validateSetup).not.toHaveBeenCalled()
  })

  it("renders zero beside a required row with the wallet's own-rule sentence", async () => {
    await mount({ clauses: presetPath() })
    await typeThreshold('editor-group-1-threshold', '0')
    await press('editor-continue')
    expect(allByTestId('editor-wallet-refusal')).toEqual([refusals.thresholdBelowOneOwnRule])
  })

  it('refuses a preset whose group still has unfilled slots with the members sentence', async () => {
    const { validateSetup } = await mount({
      clauses: [
        { threshold: 1, credentials: [PASSKEY] },
        { threshold: 2, credentials: [ALICE, emptySlotOf('ecdsa'), emptySlotOf('zkpassport')] }
      ]
    })
    await press('editor-continue')
    expect(allByTestId('editor-wallet-refusal')).toEqual([refusals.thresholdAboveMembers])
    expect(validateSetup).not.toHaveBeenCalled()
  })

  it('refuses a stored wait past the field width with the width sentence alone', async () => {
    const { validateSetup } = await mount({ clauses: presetPath(), wait: TWO_TO_THE_48 })
    await press('editor-continue')
    expect(allByTestId('editor-wallet-refusal')).toEqual([refusals.waitFieldWidth])
    expect(validateSetup).not.toHaveBeenCalled()
  })

  it('clears the refusal on the next edit, and then runs the path check', async () => {
    const { validateSetup, navigate } = await mount({
      clauses: [
        { threshold: 1, credentials: [PASSKEY] },
        { threshold: 2, credentials: [] }
      ]
    })
    await press('editor-continue')
    expect(allByTestId('editor-wallet-refusal')).toEqual([refusals.emptyGroup])

    await press('editor-group-1-remove')
    expect(byTestId('editor-wallet-refusals')).toBeNull()

    await press('editor-continue')
    expect(validateSetup).toHaveBeenCalledWith(draftOf([{ threshold: 1, credentials: [PASSKEY] }]))
    expect(navigate).toHaveBeenCalledWith(WEB_ROUTES.socialRecoverySetupWaitingPeriod)
  })
})

describe('continue with a shape this wallet can save', () => {
  it('runs the path check and shows no refusal of its own', async () => {
    const { validateSetup, navigate } = await mount({ clauses: presetPath() })
    await press('editor-continue')
    expect(validateSetup).toHaveBeenCalledWith(draftOf(presetPath()))
    expect(navigate).toHaveBeenCalledWith(WEB_ROUTES.socialRecoverySetupWaitingPeriod)
    expect(byTestId('editor-wallet-refusals')).toBeNull()
  })

  it('renders a rule too wide for a block as the "path too large" sentence and stays', async () => {
    const { navigate } = await mount({
      clauses: presetPath(),
      validate: async () => ({ errors: [finding('rule.too-wide')], warnings: [] })
    })
    await press('editor-continue')
    expect(allByTestId('editor-finding')).toEqual([refusals.tooLarge])
    expect(byTestId('editor-wallet-refusals')).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('renders a backup too wide and an unsupported action through the sentences mapped for them', async () => {
    await mount({
      clauses: presetPath(),
      validate: async () => ({
        errors: [finding('backup.too-wide'), finding('action.unsupported')],
        warnings: []
      })
    })
    await press('editor-continue')
    expect(allByTestId('editor-finding')).toEqual([
      refusals.tooLarge,
      en.socialRecovery.review.blocked.cannotRecover.reasonNotSupported
    ])
  })
})

describe('the rules panel', () => {
  it('lists the header and the nine rules in order on an empty editor', async () => {
    await mount()
    expect(byTestId('editor-rules-header')?.textContent).toBe(rules.header)
    expect(allByTestId('editor-rules-line')).toEqual(PANEL)
  })

  it('stays the same beside a refusal and is never one itself', async () => {
    await mount({
      clauses: [
        { threshold: 1, credentials: [PASSKEY] },
        { threshold: 2, credentials: [] }
      ]
    })
    await press('editor-continue')
    expect(allByTestId('editor-rules-line')).toEqual(PANEL)
    const panel = byTestId('editor-rules')
    expect(panel?.querySelector('[data-testid="editor-wallet-refusal"]')).toBeNull()
    expect(
      byTestId('editor-wallet-refusals')?.querySelector('[data-testid="editor-rules-line"]')
    ).toBeNull()
  })
})
