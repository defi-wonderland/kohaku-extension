# Account recovery module

The code of the social recovery feature, which every screen calls "Account recovery". The design and the task split are in `docs/social-recovery/`; read `docs/social-recovery/README.md` first. The ux chapter `docs/social-recovery/design/ux.md` is the rule where any other text differs from it.

## Lanes

Every task builds in its own folder and touches no file another task touches. Each lane folder holds a `README.md` naming its tasks.

| Lane | Task |
| --- | --- |
| `sdk-doubles/` | PT-035 |
| `shared/display/` | PT-036 |
| `shared/rule-lines/` | PT-037 |
| `shared/client/` | PT-038 |
| `shared/writes/` | PT-039 |
| `shared/records/` | PT-040 |
| `shared/ceremony/` | PT-041 |
| `onboarding/create/` | PT-042 |
| `setup/presets/` | PT-043 |
| `setup/editor/` | PT-044, PT-045 |
| `setup/enroll/` | PT-046, PT-069 |
| `setup/privacy/` | PT-047 |
| `setup/card/` | PT-048 |
| `setup/review/` | PT-049, PT-050 |
| `setup/arm/` | PT-051 |
| `onboarding/recover/` | PT-052 |
| `onboarding/fast-track/` | PT-053 |
| `recovery/entry/` | PT-054, PT-055, PT-056 |
| `recovery/checklist/` | PT-057, PT-058, PT-059, PT-070 |
| `recovery/submit/` | PT-060 |
| `recovery/wait/` | PT-061 |
| `recovery/done/` | PT-062 |
| `guardian-page/` | PT-063, PT-064 |
| `watcher/` | PT-065 |
| `cancel/` | PT-066 |
| `management/overview/` | PT-067 |
| `management/editor/` | PT-068 |

`__tests__/` holds the setup task's own checks.

## The two frozen folders

The setup task owns these two folders, and they are frozen after it.

- `sdk-interfaces/` declares the twelve SDK interfaces of `design/sdk.md` D-201 and every value record its freeze list names, hand-written at design commit `bd8780f7ad59a451035b15920c00015a2eee6e9b`. A change here is a design change first.
- `routes/` holds `SocialRecoveryRoutes.tsx`, the module's route registry. `MainRoutes.tsx` mounts it once at `social-recovery/*` inside the full-tab group, so every surface opens in a full tab (D-316). A task adds exactly one `<Route>` line for its screen, inside the guard group its surface needs: the owner's group (keystore unlocked and an account) or the open group (the guardian page, the fast track and the recover door run without a keystore). This is the one module file more than one lane touches.

## Rules

- A screen imports `shared/client`, never `sdk-doubles`. Only `shared/client` and the tests of `sdk-doubles` import the doubles, so the swap to the real SDK touches one folder. ESLint enforces this rule (`no-restricted-imports` in the root `.eslintrc.js`). The rule catches static `import` statements and `export ... from` re-exports. It does not catch a dynamic `import()` or a `require()`, so a reviewer checks those.
- Every string a screen shows is a key under `socialRecovery` in `src/common/config/localization/translations/en.json`, read through `i18n.t('socialRecovery.<group>.<key>')`. Keys are slugs and hold no `.` and no `:`. A lane uses keys and adds none: a lane that finds a missing string reports it to the coordinator, who adds it in the setup branch or in a `chore/social-recovery-strings-<n>` pull request.
- Every string follows `docs/social-recovery/design/ux-copy.md`. The copy-lint test in `__tests__/` enforces its bans.
- The four approval values UXC-14 names are the first four value keys under `socialRecovery.display.values` after the account lines: `newKey`, `keyBeingRemoved`, `payment` or `noPayment`, and `deadline`. `controlledBy` and `removed` are the done screen's pair, the one exception D-302 states, and no other screen uses them.
- Records live in the extension's local storage, never in a background controller (D-310).
- A test under this folder runs in Jest's node environment and imports through the `@web/...` and `@common/...` aliases. A test that needs a DOM declares `@jest-environment jsdom` in its docblock.
