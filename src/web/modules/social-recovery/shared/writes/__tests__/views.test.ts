/**
 * PT-039, the two views: `WriteStateView` and `DepositStepView` lay out what
 * the renderers answer and add no copy and no link of their own, so the
 * strings copy.test.ts checks are the strings a holder reads.
 *
 * The repository's Jest runs ts-jest under `jsx: react-native`, which leaves
 * JSX untransformed, so a view cannot be mounted here. This file reads the
 * two view sources instead: every field of the rendered state and step is
 * laid out, the text comes from the renderer, and nothing opens a link.
 *
 * Sources: briefs/PT-039.md ("Shape": two React components render the states
 * and the deposit step from that data through socialRecovery.writes keys; the
 * rules live in the functions), task file done entry 3 (it renders no faucet
 * link), design/ux.md D-312.
 */
import fs from 'fs'
import path from 'path'

const VIEWS = path.resolve(__dirname, '..', 'components')

const code = (file: string): string =>
  fs
    .readFileSync(path.join(VIEWS, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const STATE_VIEW = code('WriteStateView.tsx')
const STEP_VIEW = code('DepositStepView.tsx')

/** Literal text between JSX tags: copy a view would carry of its own. */
const jsxLiterals = (source: string): string[] =>
  (source.match(/>\s*([A-Za-z][^<>{}]*?)\s*</g) ?? [])
    .map((m) => m.slice(1, -1).trim())
    .filter((s) => /[A-Za-z]{2,}/.test(s))

describe('WriteStateView', () => {
  it('renders from renderWriteState', () => {
    expect(STATE_VIEW).toMatch(/\brenderWriteState\(/)
  })
  ;(
    [
      ['the chip', /rendered\.chip\b/],
      ['the title', /rendered\.title\b/],
      ['every line', /rendered\.lines\.map\(/],
      ["the controller's label", /rendered\.controller\.label\b/],
      ["the controller's address", /rendered\.controller\.address\b/],
      ['the retry', /rendered\.retry\b/]
    ] as [string, RegExp][]
  ).forEach(([name, pattern]) =>
    it(`lays out ${name}`, () => {
      expect(STATE_VIEW).toMatch(pattern)
    })
  )

  it('carries no copy of its own', () => {
    expect(jsxLiterals(STATE_VIEW)).toEqual([])
  })
})

describe('DepositStepView', () => {
  it('renders from renderDepositStep', () => {
    expect(STEP_VIEW).toMatch(/\brenderDepositStep\(/)
  })
  ;(
    [
      ['the eyebrow', /rendered\.eyebrow\b/],
      ['the title', /rendered\.title\b/],
      ['the lead', /rendered\.lead\b/],
      ["the key's label", /rendered\.keyLabel\b/],
      ["the key's address", /rendered\.keyAddress\b/],
      ['the copy action', /rendered\.copyLabel\b/],
      ['every route', /rendered\.routes\.map\(/],
      ["each route's line", /route\.line\b/],
      ["each route's note", /route\.note\b/],
      ['the notes, the transfer sentence and the second funding among them', /rendered\.notes\b/],
      ['the waiting lines', /rendered\.waiting\b/],
      ['the hint under the actions', /rendered\.actionHint\b/],
      ["the blocker's title", /rendered\.blocker\.title\b/],
      ["the blocker's line", /rendered\.blocker\.line\b/]
    ] as [string, RegExp][]
  ).forEach(([name, pattern]) =>
    it(`lays out ${name}`, () => {
      expect(STEP_VIEW).toMatch(pattern)
    })
  )

  it('carries no copy of its own', () => {
    expect(jsxLiterals(STEP_VIEW)).toEqual([])
  })
})

describe('neither view opens a link (D-312: no faucet link)', () => {
  ;[
    ['WriteStateView', STATE_VIEW],
    ['DepositStepView', STEP_VIEW]
  ].forEach(([name, source]) =>
    it(name, () => {
      expect(source).not.toMatch(/faucet/i)
      expect(source).not.toMatch(/\bhref\b|\bLinking\b|openURL|openInTab|openBrowser|https?:\/\//)
    })
  )
})
