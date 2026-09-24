/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "chrome-extension://cgjhdpkjghcgpplimocodhjgcceglpoj/tab.html#/social-recovery/ceremony"}
 */
/**
 * The ceremony tab screen, rendered (ux.md D-316): it runs nothing outside a
 * full tab, resolves and runs nothing while the tab is hidden, writes its
 * report to the extension's storage only once the tab is shown, and shows no
 * raw slug.
 *
 * The repository's Jest config compiles TSX with `jsx: react-native`, which
 * keeps the JSX, so a test cannot import a component. This file transpiles the
 * screen with the TypeScript compiler's React JSX and evaluates it under
 * Jest's own `require`, so every import resolves through the aliases and the
 * mocks below. The shared components are stubs; the lane's modules, i18next
 * and en.json are real.
 */
/* eslint-disable global-require, import/no-dynamic-require, @typescript-eslint/no-var-requires */
import fs from 'fs'
import path from 'path'
import React from 'react'
import { createRoot, Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { MemoryRouter } from 'react-router-dom'
import ts from 'typescript'

import {
  callerParams,
  ceremony,
  fakeAssertion,
  fakeAttestation,
  fakeMethod,
  fakeOrchestrator,
  fixtureRequest,
  flush,
  generatePoint,
  installCredentials,
  MethodScript,
  notAllowedError,
  P256Point,
  PASSKEY_METHOD,
  resetVisibility,
  setVisibility,
  SYNCED_FLAGS
} from './harness'

const mockUi = { isTab: true, isPopup: false, isActionWindow: false }
const mockSource: { current: Record<string, unknown> } = { current: {} }

jest.mock('@web/utils/uiType', () => ({ getUiType: () => mockUi }))
jest.mock('@web/modules/social-recovery/shared/ceremony/screen/CeremonySource', () => ({
  __esModule: true,
  useCeremonySource: () => mockSource.current,
  CeremonySourceProvider: ({ children }: { children: unknown }) => children
}))
jest.mock('@common/components/Button', () => {
  const R = jest.requireActual('react')
  return {
    __esModule: true,
    default: ({ text, onPress }: { text: string; onPress?: () => void }) =>
      R.createElement('button', { onClick: onPress }, text)
  }
})
jest.mock('@common/components/Panel', () => {
  const R = jest.requireActual('react')
  return {
    __esModule: true,
    default: ({ children }: { children: unknown }) => R.createElement('div', null, children)
  }
})
jest.mock('@common/components/Spinner', () => ({ __esModule: true, default: () => null }))
jest.mock('@common/components/Text', () => {
  const R = jest.requireActual('react')
  return {
    __esModule: true,
    default: ({ children }: { children: unknown }) => R.createElement('p', null, children)
  }
})
jest.mock('@common/hooks/useTheme', () => ({ __esModule: true, default: () => ({ theme: {} }) }))
// The style tables read the app's env module, which loads Expo's ESM builds.
jest.mock('@common/styles/spacings', () => ({
  __esModule: true,
  default: new Proxy({}, { get: () => ({}) })
}))
jest.mock('@common/styles/utils/flexbox', () => ({
  __esModule: true,
  default: new Proxy({}, { get: () => ({}) })
}))
jest.mock('@common/modules/header/components/Header', () => ({
  __esModule: true,
  default: () => null
}))
jest.mock('@web/components/TabLayoutWrapper/TabLayoutWrapper', () => {
  const R = jest.requireActual('react')
  const Box = ({ children }: { children: unknown }) => R.createElement('div', null, children)
  return { __esModule: true, TabLayoutContainer: Box, TabLayoutWrapperMainContent: Box }
})

const SCREEN = path.resolve(__dirname, '../screen/CeremonyScreen.tsx')

/** The screen, transpiled with React JSX and evaluated under Jest's require. */
const loadScreen = (): React.ComponentType => {
  const { outputText } = ts.transpileModule(fs.readFileSync(SCREEN, 'utf8'), {
    fileName: SCREEN,
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    }
  })
  const mod = { exports: {} as Record<string, unknown> }
  const screenRequire = (id: string) =>
    require(id.startsWith('.') ? path.resolve(path.dirname(SCREEN), id) : id)
  // The transpiled screen is this repository's own source, run once per render.
  // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
  new Function('require', 'module', 'exports', outputText)(screenRequire, mod, mod.exports)
  return mod.exports.default as React.ComponentType
}

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let point: P256Point
let root: Root | null = null
let container: HTMLElement | null = null

beforeAll(async () => {
  point = await generatePoint()
  // react-dom 18.3 deprecates its test-utils act, and this React build has no
  // other: the one warning is dropped, every other error still prints.
  // eslint-disable-next-line no-console
  const printError = console.error.bind(console)
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes('ReactDOMTestUtils.act')) return
    printError(...args)
  })
})

afterAll(() => {
  jest.restoreAllMocks()
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  container?.remove()
  resetVisibility()
  mockUi.isTab = true
  mockUi.isPopup = false
  mockUi.isActionWindow = false
})

const fakeStore = () => ({
  get: jest.fn<Promise<unknown>, [string, unknown?]>(async () => null),
  set: jest.fn<Promise<unknown>, [string, unknown]>(async () => null),
  remove: jest.fn<Promise<unknown>, [string]>(async () => null)
})

const render = async (search: string) => {
  const Screen = loadScreen()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      React.createElement(
        MemoryRouter,
        {
          initialEntries: [`/social-recovery/ceremony${search}`],
          future: { v7_startTransition: true, v7_relativeSplatPath: true }
        },
        React.createElement(Screen)
      )
    )
  })
  await act(async () => flush(20))
  return container
}

const source = (script: MethodScript = {}) => {
  const method = fakeMethod(script)
  const orchestrator = fakeOrchestrator(method)
  const store = fakeStore()
  const resolve = jest.fn(async () => ({
    orchestrator,
    method,
    methodAddress: PASSKEY_METHOD,
    params: callerParams(),
    request: fixtureRequest()
  }))
  mockSource.current = { resolve, store, visibility: document }
  return { method, orchestrator, store, resolve }
}

const ENROLL = '?call=enroll&method=passkey&id=req-1'
const TEST = '?call=testAccess&method=passkey&id=req-1'

/** The outcome of the one report the tab wrote. */
const reported = (store: ReturnType<typeof fakeStore>) =>
  (store.set.mock.calls[0][1] as { outcome: unknown }).outcome

describe('the ceremony tab screen', () => {
  let creds: ReturnType<typeof installCredentials>

  beforeEach(() => {
    creds = installCredentials({
      create: async () => fakeAttestation({ flags: SYNCED_FLAGS, point }).credential,
      get: async () => fakeAssertion({ r: BigInt(5), s: BigInt(6) }).credential
    })
  })

  afterEach(() => creds.restore())

  it('runs an enrollment in a visible full tab and writes its report', async () => {
    setVisibility('visible', false)
    const { resolve, store } = source()
    const page = await render(ENROLL)
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(creds.create).toHaveBeenCalledTimes(1)
    expect(store.set).toHaveBeenCalledTimes(1)
    expect(store.set.mock.calls[0][0]).toBe('socialRecoveryCeremonyResult:req-1')
    expect(page.textContent).toContain('Synced passkey')
  })

  // D-316: the full-tab rule, kept by the screen itself as well as TabOnlyRoute.
  ;[
    ['the action popup', { isTab: false, isPopup: true, isActionWindow: false }],
    ['an action window', { isTab: false, isPopup: false, isActionWindow: true }]
  ].forEach(([where, ui]) =>
    it(`resolves, prompts and reports nothing in ${where as string}`, async () => {
      Object.assign(mockUi, ui)
      setVisibility('visible', false)
      const { resolve, store } = source()
      const page = await render(ENROLL)
      expect(resolve).not.toHaveBeenCalled()
      expect(creds.create).not.toHaveBeenCalled()
      expect(store.set).not.toHaveBeenCalled()
      expect(page.textContent).toContain('This step continues in a new tab.')
    })
  )

  // D-316: a hidden tab dispatches nothing, the resolve included.
  it('resolves and prompts nothing while hidden, then runs once shown', async () => {
    setVisibility('hidden', false)
    const { resolve, store } = source()
    await render(ENROLL)
    expect(resolve).not.toHaveBeenCalled()
    expect(creds.create).not.toHaveBeenCalled()
    expect(store.set).not.toHaveBeenCalled()

    await act(async () => {
      setVisibility('visible')
      await flush(20)
    })
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(creds.create).toHaveBeenCalledTimes(1)
    expect(store.set).toHaveBeenCalledTimes(1)
  })

  it('reads a resolver that fails as unavailable, with a retry', async () => {
    setVisibility('visible', false)
    const { store } = source()
    ;(mockSource.current as { resolve: jest.Mock }).resolve.mockRejectedValueOnce(
      new Error('the records did not answer')
    )
    const page = await render(ENROLL)
    expect(reported(store)).toMatchObject({ kind: 'verdict', verdict: 'unavailable', retry: true })
    expect(page.textContent).toContain('Try again')
    expect(page.textContent).not.toContain('the records did not answer')
  })

  it('shows no raw cause slug and no English message of the method', async () => {
    setVisibility('visible', false)
    const { store } = source({
      configFrom: { throws: new Error('an English refusal from the method') }
    })
    const page = await render(ENROLL)
    expect(reported(store)).toMatchObject({ kind: 'verdict', verdict: 'failed' })
    const text = page.textContent ?? ''
    expect(text).not.toContain('an English refusal from the method')
    const slugs = [...ceremony().HOST_CAUSES, 'material-rejected', 'device-unavailable']
    slugs.forEach((slug) => expect(text).not.toContain(slug))
    expect(text).toContain('Failed · Try again')
  })

  it("shows the browser's error name beside test failed (frame C-05)", async () => {
    setVisibility('visible', false)
    creds.restore()
    creds = installCredentials({
      get: async () => {
        throw notAllowedError()
      }
    })
    const { store } = source()
    const page = await render(TEST)
    expect(reported(store)).toMatchObject({ kind: 'verdict', verdict: 'failed' })
    const text = page.textContent ?? ''
    expect(text).toContain('Test failed')
    expect(text).toContain('NotAllowedError')
    expect(text).toContain('This method may never work.')
    expect(text).not.toContain('Not tested')
    expect(text).not.toContain('The operation either timed out')
  })
})
