/**
 * @jest-environment jsdom
 *
 * The deposit step's copy action on the mounted view. A copy the clipboard
 * refuses, or answers false for, shows the line that tells the holder to
 * select the address by hand; a copy that succeeds shows nothing; a screen's
 * own copy action gets the address and leaves the clipboard alone.
 *
 * The repository's Jest runs ts-jest under `jsx: react-native`, which leaves
 * JSX untransformed, so the test compiles the view's source with its JSX as
 * `React.createElement` and loads it with the app's button, text, styles and
 * clipboard replaced by plain stand-ins. jsdom has no `TextEncoder`, which
 * the module's chain reads load, so the test sets Node's before it loads the
 * module.
 */
import fs from 'fs'
import path from 'path'
import * as React from 'react'
import { createRoot, Root } from 'react-dom/client'
import ts from 'typescript'
import { TextDecoder, TextEncoder } from 'util'
import vm from 'vm'

import type { DepositStepViewProps } from '@web/modules/social-recovery/shared/writes/components/DepositStepView'

Object.assign(globalThis, { TextEncoder, TextDecoder })

const harness = jest.requireActual<typeof import('./harness')>('./harness')
const { depositStepFor, GAS_KEYS, renderDepositStep } = harness
const { appTranslate: t } = jest.requireActual<
  typeof import('@web/modules/social-recovery/shared/display')
>('@web/modules/social-recovery/shared/display')

const VIEWS = path.resolve(__dirname, '..', 'components')

// React 18.3.0 exports `act` only as `unstable_act`.
const act: typeof React.act =
  (React as unknown as { act?: typeof React.act }).act ??
  (React as unknown as { unstable_act: typeof React.act }).unstable_act
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const setStringAsync = jest.fn<Promise<boolean>, [string]>()
const StandInButton = ({ text: label, onPress }: { text: string; onPress: () => void }) =>
  React.createElement('button', { type: 'button', onClick: onPress }, label)
const StandInText = ({ children }: { children?: React.ReactNode }) =>
  React.createElement('span', null, children)
/** Every style the view asks for is empty: the app's style modules load the native app config. */
const noStyles = new Proxy({}, { get: () => ({}) })
const STAND_INS: Record<string, unknown> = {
  '@common/components/Button': { __esModule: true, default: StandInButton },
  '@common/components/Text': { __esModule: true, default: StandInText },
  '@common/styles/spacings': { __esModule: true, default: noStyles },
  '@common/styles/utils/flexbox': { __esModule: true, default: noStyles },
  '@common/utils/clipboard': { setStringAsync }
}

const loadView = (): React.ComponentType<DepositStepViewProps> => {
  const file = path.join(VIEWS, 'DepositStepView.tsx')
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true
    }
  })
  const load = (specifier: string): unknown =>
    STAND_INS[specifier] ??
    jest.requireActual(specifier.startsWith('.') ? path.resolve(VIEWS, specifier) : specifier)
  const loaded: { exports: { default?: React.ComponentType<DepositStepViewProps> } } = {
    exports: {}
  }
  vm.compileFunction(outputText, ['require', 'module', 'exports'], { filename: file })(
    load,
    loaded,
    loaded.exports
  )
  if (!loaded.exports.default) throw new Error('DepositStepView exports no component')
  return loaded.exports.default
}
const DepositStepView = loadView()

const COPY_FAILED = t(GAS_KEYS.copyFailed)

let root: Root | undefined
let container: HTMLElement

beforeEach(() => {
  setStringAsync.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  container.remove()
})

const mount = async (props: Omit<DepositStepViewProps, 'step'> = {}) => {
  const step = await depositStepFor('submission', false)
  root = createRoot(container)
  await act(async () => {
    root?.render(React.createElement(DepositStepView, { step, ...props }))
  })
  return renderDepositStep(step)
}

const pressCopy = async () => {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === t(GAS_KEYS.copy)
  )
  if (!button) throw new Error('The copy button is not on the step')
  await act(async () => {
    button.click()
    await new Promise((settle) => {
      setTimeout(settle, 0)
    })
  })
}

describe('DepositStepView: copying the key address', () => {
  it('a copy the clipboard refuses shows the line that says the address was not copied', async () => {
    setStringAsync.mockRejectedValue(new Error('The document is not focused'))
    const rendered = await mount()
    expect(container.textContent).toContain(rendered.keyAddress)
    expect(container.textContent).not.toContain(COPY_FAILED)
    await pressCopy()
    expect(setStringAsync).toHaveBeenCalledWith(rendered.keyAddress)
    expect(container.textContent).toContain(COPY_FAILED)
  })

  it('a copy the clipboard answers false for shows the same line', async () => {
    setStringAsync.mockResolvedValue(false)
    await mount()
    await pressCopy()
    expect(container.textContent).toContain(COPY_FAILED)
  })

  it('a copy that succeeds shows no such line', async () => {
    setStringAsync.mockResolvedValue(true)
    await mount()
    await pressCopy()
    expect(setStringAsync).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toContain(COPY_FAILED)
  })

  it('the blocker shows the line too when its copy fails', async () => {
    setStringAsync.mockRejectedValue(new Error('The document is not focused'))
    const rendered = await mount({ variant: 'blocker' })
    expect(container.textContent).toContain(rendered.blocker.title)
    await pressCopy()
    expect(container.textContent).toContain(COPY_FAILED)
  })

  it("a screen's own copy action gets the address, and the clipboard is not touched", async () => {
    const onCopy = jest.fn()
    const rendered = await mount({ onCopy })
    await pressCopy()
    expect(onCopy).toHaveBeenCalledWith(rendered.keyAddress)
    expect(setStringAsync).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain(COPY_FAILED)
  })
})
