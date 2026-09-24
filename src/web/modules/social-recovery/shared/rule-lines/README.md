# shared/rule-lines

- PT-037 The rule lines

The rule lines of `docs/social-recovery/design/ux.md` D-305: one pure function that turns a path's shape into the lines that state its consequences. The recommended-path card, the setup and management editors, the review, the recoverer's readout and the done screen's exits all render their lines from it. The SDK returns no verdict on a rule, so these lines are the wallet's own calls on rule quality.

## Use

```ts
import { getRuleLines, renderRuleLines } from '@web/modules/social-recovery/shared/rule-lines'

const lines = getRuleLines(draft) // or getRuleLines(draft.clauses)
const text = renderRuleLines(lines, t) // t is i18n.t or useTranslation().t
```

`getRuleLines` returns ordered descriptors `{ key, params }`. `key` is a full `en.json` key under `socialRecovery.ruleLines`, and `params` holds the placeholders `n`, `m` and `spare` (M minus N) the string needs. `RULE_LINE_KEYS` names every key, so a surface can pick or drop a line by key, for example the sizing rule line the editor alone states.

## How it reads a shape

- Input: the setup draft record of `sdk-interfaces/` (`SetupDraft`) or its `clauses`. The lane declares no path type of its own.
- A clause with one credential is a required row. A clause with more is a group. A group of one member is one method, D-305, and reads as a row.
- D-305 generates the lines from the whole path, and the editor renders them for the path as it stands, before any refusal shows. So one refused clause silences the whole path: `getRuleLines` returns `[]`. A clause is refused when it has no credential, or its threshold is not a whole number, is below zero, is above its member count, or is above the 255 its field counts (contracts D-103, sdk.md `clause.threshold-too-wide`).
- A clause at threshold zero is not refused here. It requires nothing, so it earns no line and its members count toward no line; the other clauses keep their lines.
- The one failure domain line keys on the method family, D-312: two members share a family when their `method` addresses are equal. A passport and an Aadhaar identity read as two domains.
- Order, D-305: the rows' line or the single-method block, then each group's threshold line followed by its failure domain line, then the different places line, then the sizing rule line.

| Shape | Lines |
| --- | --- |
| One method (one row, or a group of one) | `singleMethod`, `secondMethodOffer`, `platformFate` |
| Two rows | `bothMustAnswer`, `differentPlaces`, `sizingRule` |
| N rows, N of three or more | `allMustAnswer` {n}, `differentPlaces` |
| One group, 1 of 2 | `eitherOneAlone`, `differentPlaces` |
| One group, 1 of M, M of three or more | `anyOneOfM` {m}, `differentPlaces` |
| One group, N of M, N from two to M minus one | `anyNOfM` {n, m, spare}, `differentPlaces` |
| One group, M of M | `everyMemberMustAnswer`, `differentPlaces` |
| Rows and one group, N below M | `togetherWithRequired` {n, m, spare}, `differentPlaces` |
| Rows and one group, M of M | `togetherWithRequiredEveryMember`, `differentPlaces` |
| Two or more groups and no row, per group with N below M | `togetherWithGroups` {n, m, spare} |
| Two or more groups and no row, per group with M of M | `togetherWithGroupsEveryMember` |
| Rows and two or more groups, per group with N below M | `togetherWithRequiredAndGroups` {n, m, spare} |
| Rows and two or more groups, per group with M of M | `togetherWithRequiredAndGroupsEveryMember` |
| A group whose members share one method family | its threshold line, then `oneFailureDomain` |
| Any refused clause anywhere in the path | `[]` |
| Empty path, or only clauses at threshold zero | `[]` |

A group at threshold M reads its every-member line in place of the count line (frame C-04e). Beside a row or another group, the together-with forms keep the any N of M wording at threshold one too, since no member alone can then recover or take the account. Groups keep clause order; the `differentPlaces` line follows the last group.

The function produces nothing about the identity method's weight, the words primary or offered, or raising a threshold when a secondary credential joins, D-312.

Tests live in `__tests__/`, which the tester of PT-037 owns.
