# shared/display

- PT-036 Display rules and the status vocabulary

The value renderers and the status vocabulary of D-302 (`docs/social-recovery/design/ux.md`) that every recovery surface calls. Each value type renders in exactly one form and each status word exists once, here. A screen never truncates a value, spells a chip, a kit noun or a password name on its own: it imports them from `@web/modules/social-recovery/shared/display`.

## Files

| File | Holds |
| --- | --- |
| `translate.ts` | The `Translate` type and `appTranslate`, the app's i18next `t`. |
| `vocabulary.ts` | The closed `as const` chip sets, the kit nouns, the two password names, the value labels and their i18n keys. |
| `renderers.ts` | One pure renderer per value type. |
| `index.ts` | The lane's public surface. |

## Rules

- Every renderer is a pure function. It reads no clock, no zone and no storage; the deadline and the countdown take `now`, the remaining time and the zone as parameters.
- Every string comes from `socialRecovery.status.*` or `socialRecovery.display.*` in `en.json`, through a `t` parameter that defaults to the app's i18next instance. A test passes the default or its own `t` and runs under Jest's node environment.
- The chip sets are closed. `METHOD_CHIPS`, `COLLECTION_CHIPS`, `ATTEMPT_CHIPS` and `RECOVERY_STATUS_CHIPS` (the states `RECOVERY_STATES` and the chips beside them `RECOVERY_ASIDE_CHIPS`) are the four sets of D-302. `SESSION_CHIPS` (not submitted), `REQUEST_CHIPS` (expired, void, setup changed) and `EDITOR_CHIPS` (still needed) hold the other states D-302 names. `chipKey(set, chip)` maps a chip to its key.
- The label for a safe account never appears, I-26. The banned words of `ux-copy.md` appear in no string of this lane.
- A resolved name carries the I-41 caveat beside a full address to check (`besideAddressToCheck`) and alone for an address to act on (`aloneForAction`), and not where the screen asks the reader to check nothing (`informationOnly`).
- The second-release words stay in the sets and the renderers (the chips did not answer and stopped, the stopped countdowns, the payment order, D-393). A first-release screen never selects them.

## Value forms

| Value | Renderer | Form |
| --- | --- | --- |
| Address, short | `renderShortAddress` | `0x2b0F…6ef5`, checksummed |
| Address, full | `renderFullAddress` | whole, checksummed, no grouping |
| Name or method name | `ellipsizeName` | whole up to 24 characters, 23 and `…` past that |
| Resolved name | `renderResolvedName` | the name and the I-41 caveat or null |
| Hash or challenge | `renderHash` | `0x8f31a27b04ce…5d19c2`, twelve and six |
| Approval | `renderApproval` | `0x8ba2c71f04e9…5fa37ad3`, twelve and eight |
| Hidden value | `renderHiddenValue` | sixteen dots and the hidden chip |
| Member list | `renderMemberList` | three members and `2 more members`; `showAll` for the checklist of D-392 |
| Payment order | `renderPaymentOrder` | `12.50 USDC to 0x…`, `12.50 USDC to whoever executes` or `No payment` |
| Deadline | `renderDeadline` | `Valid until 13 Aug, 18:04 CEST · 23 hours left` |
| Countdown | `renderCountdown` | `47:12:06 · waiting`, `Execution due` and the two stopped forms |
