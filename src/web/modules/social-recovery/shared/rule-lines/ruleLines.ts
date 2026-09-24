/**
 * The rule lines of D-305: the wallet's own calls on a path's consequences,
 * generated from the path's shape. The SDK returns no verdict on a rule, so
 * these lines are where the holder reads what a shape costs.
 *
 * The input is the setup draft record of `sdk-interfaces/` (sdk.md D-202), or
 * its clauses alone. A clause with one credential is a required row, and a
 * clause with more is a group. A group of one member is one method (D-305), so
 * it reads as a row: the draft record draws no line between the two.
 *
 * D-305 generates the lines from the whole path, and the editor renders them
 * for the path as it stands, before any refusal shows. A path with a refused
 * clause therefore earns no line at all, since a line about the rest of the
 * path would read a lockout as a rescue. A threshold of zero is refused like
 * the others: it sits outside its members like a threshold above them, and
 * the editor refuses a group nothing has to fill (D-305). A path that holds one
 * enrolled method twice, anywhere, is refused the same way.
 *
 * The one failure domain line keys on the method family (D-312, 2026-09-17).
 * A credential's family is its method module, so two credentials share a
 * family when their `method` addresses are equal. A passport and an Aadhaar
 * identity sit behind two modules and read as two domains.
 *
 * Nothing here produces the identity method's weight line, the words primary
 * or offered, or the kit's guidance to raise a threshold when a secondary
 * credential joins a clause (D-305, D-312).
 *
 * Pure: the same input yields equal output and the input is never mutated.
 */
import type { Clause, Credential, SetupDraft } from '@web/modules/social-recovery/sdk-interfaces'

const PREFIX = 'socialRecovery.ruleLines'

/** Every key this function emits, each one under `socialRecovery.ruleLines` in `en.json`. */
export const RULE_LINE_KEYS = {
  allMustAnswer: `${PREFIX}.allMustAnswer`,
  bothMustAnswer: `${PREFIX}.bothMustAnswer`,
  singleMethod: `${PREFIX}.singleMethod`,
  secondMethodOffer: `${PREFIX}.secondMethodOffer`,
  platformFate: `${PREFIX}.platformFate`,
  anyNOfM: `${PREFIX}.anyNOfM`,
  eitherOneAlone: `${PREFIX}.eitherOneAlone`,
  anyOneOfM: `${PREFIX}.anyOneOfM`,
  togetherWithRequired: `${PREFIX}.togetherWithRequired`,
  togetherWithRequiredAndGroups: `${PREFIX}.togetherWithRequiredAndGroups`,
  togetherWithGroups: `${PREFIX}.togetherWithGroups`,
  everyMemberMustAnswer: `${PREFIX}.everyMemberMustAnswer`,
  togetherWithRequiredEveryMember: `${PREFIX}.togetherWithRequiredEveryMember`,
  togetherWithGroupsEveryMember: `${PREFIX}.togetherWithGroupsEveryMember`,
  togetherWithRequiredAndGroupsEveryMember: `${PREFIX}.togetherWithRequiredAndGroupsEveryMember`,
  oneFailureDomain: `${PREFIX}.oneFailureDomain`,
  differentPlaces: `${PREFIX}.differentPlaces`,
  sizingRule: `${PREFIX}.sizingRule`
} as const

export type RuleLineKey = typeof RULE_LINE_KEYS[keyof typeof RULE_LINE_KEYS]

/** The placeholders of the `ruleLines` strings: `spare` is M minus N. */
export interface RuleLineParams {
  n?: number
  m?: number
  spare?: number
}

/** One rule line: an `en.json` key and the values its placeholders take. */
export interface RuleLine {
  key: RuleLineKey
  params: RuleLineParams
}

/** The translate function `renderRuleLines` takes, `i18n.t` or `useTranslation().t`. */
export type Translate = (key: string, params?: RuleLineParams) => string

/** The path the lines read: the setup draft record, or its clauses alone. */
export type RuleLinesInput = Pick<SetupDraft, 'clauses'> | readonly Clause[]

const line = (key: RuleLineKey, params: RuleLineParams = {}): RuleLine => ({ key, params })

const familyOf = (credential: Credential): string => credential.method.toLowerCase()

/** The widest threshold the clause's field counts (contracts D-103, sdk.md `clause.threshold-too-wide`). */
const MAX_THRESHOLD = 255

/**
 * A refused clause: no credential, a threshold that is not a whole number, a
 * threshold below one or above its members, or a threshold above the 255 its
 * field counts. One refused clause silences the whole path's lines.
 */
const isRefused = (clause: Clause): boolean =>
  clause.credentials.length === 0 ||
  !Number.isInteger(clause.threshold) ||
  clause.threshold < 1 ||
  clause.threshold > clause.credentials.length ||
  clause.threshold > MAX_THRESHOLD

/**
 * One enrolled method appears once across the path, never both as a required
 * row and a member (D-305), and the editor refuses a duplicate. A credential
 * is the same enrolled method when its method address and its config bytes
 * both match. Both are hex, so both compare lowercased: two strings that
 * differ only in letter case are the same bytes. The address holds no `|`, so
 * the joined key is unambiguous.
 */
const holdsDuplicate = (clauses: readonly Clause[]): boolean => {
  const seen = new Set<string>()
  return clauses.some((clause) =>
    clause.credentials.some((credential) => {
      const id = `${credential.method.toLowerCase()}|${credential.config.toLowerCase()}`
      if (seen.has(id)) return true
      seen.add(id)
      return false
    })
  )
}

const sharesOneFamily = (credentials: readonly Credential[]): boolean => {
  const first = familyOf(credentials[0])
  return credentials.every((credential) => familyOf(credential) === first)
}

const groupLine = (clause: Clause, rowCount: number, groupCount: number): RuleLine => {
  const m = clause.credentials.length
  const n = clause.threshold
  const spare = m - n

  const hasRows = rowCount > 0
  const hasOtherGroups = groupCount > 1

  // A group whose threshold equals its member count reads every member must
  // answer in place of the count line (frame C-04e), with the together-with
  // clause of D-305 where rows or another group stand beside it.
  if (n === m) {
    if (hasRows && hasOtherGroups)
      return line(RULE_LINE_KEYS.togetherWithRequiredAndGroupsEveryMember)
    if (hasRows) return line(RULE_LINE_KEYS.togetherWithRequiredEveryMember)
    if (hasOtherGroups) return line(RULE_LINE_KEYS.togetherWithGroupsEveryMember)
    return line(RULE_LINE_KEYS.everyMemberMustAnswer)
  }

  // D-305: where required rows or a second group stand beside the group, the
  // line adds the together-with clause. It keeps the any N of M form at every
  // threshold, one included, since beside another clause no member alone can
  // recover or take the account.
  if (hasRows && hasOtherGroups) {
    return line(RULE_LINE_KEYS.togetherWithRequiredAndGroups, { n, m, spare })
  }
  if (hasRows) return line(RULE_LINE_KEYS.togetherWithRequired, { n, m, spare })
  if (hasOtherGroups) return line(RULE_LINE_KEYS.togetherWithGroups, { n, m, spare })

  if (n === 1 && m === 2) return line(RULE_LINE_KEYS.eitherOneAlone)
  if (n === 1) return line(RULE_LINE_KEYS.anyOneOfM, { m })
  return line(RULE_LINE_KEYS.anyNOfM, { n, m, spare })
}

const clausesOf = (path: RuleLinesInput): readonly Clause[] =>
  Array.isArray(path) ? path : (path as Pick<SetupDraft, 'clauses'>).clauses

/**
 * The rule lines of a path, in D-305's order: the required rows' line (or the
 * single-method warning with its offer and the platform line), each group's
 * threshold line followed by its failure domain line, the setup line about
 * different places, and the sizing rule line.
 */
export const getRuleLines = (path: RuleLinesInput): RuleLine[] => {
  const clauses = clausesOf(path)
  if (clauses.some(isRefused) || holdsDuplicate(clauses)) return []

  const rows = clauses.filter((clause) => clause.credentials.length === 1)
  const groups = clauses.filter((clause) => clause.credentials.length > 1)
  const methodCount = clauses.reduce((sum, clause) => sum + clause.credentials.length, 0)

  if (methodCount === 0) return []

  if (methodCount === 1) {
    return [
      line(RULE_LINE_KEYS.singleMethod),
      line(RULE_LINE_KEYS.secondMethodOffer),
      line(RULE_LINE_KEYS.platformFate)
    ]
  }

  const lines: RuleLine[] = []

  if (groups.length === 0) {
    lines.push(
      rows.length === 2
        ? line(RULE_LINE_KEYS.bothMustAnswer)
        : line(RULE_LINE_KEYS.allMustAnswer, { n: rows.length })
    )
  }

  groups.forEach((group) => {
    lines.push(groupLine(group, rows.length, groups.length))
    if (sharesOneFamily(group.credentials)) lines.push(line(RULE_LINE_KEYS.oneFailureDomain))
  })

  lines.push(line(RULE_LINE_KEYS.differentPlaces))

  if (groups.length === 0 && rows.length === 2) lines.push(line(RULE_LINE_KEYS.sizingRule))

  return lines
}

/** Resolves each line through the translate function, in order. */
export const renderRuleLines = (lines: readonly RuleLine[], t: Translate): string[] =>
  lines.map(({ key, params }) => t(key, { ...params }))
