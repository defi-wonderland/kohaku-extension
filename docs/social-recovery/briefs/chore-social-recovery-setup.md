# Setup task: the shared files of the social recovery module

Branch `chore/social-recovery-setup`, cut from `dev/wonderland` at `603d819d7`. Pull request against `dev/wonderland` on `defi-wonderland/kohaku-extension`. Open question 23 of `docs/social-recovery/tasks/README.md` names this task; its owner is the ux owner.

## Outcome

Every M-6 lane builds into a skeleton that already exists, so no task PR of round 0, 1 or 2 touches a file another task touches. The task ships the shared files and nothing else: no double, no renderer, no screen, no record. When it merges, the seven M-6 tasks can start in their own folders with the routes, the string keys, the SDK types and the test tooling already in place.

## Design sections and deltas

- `design/sdk.md` D-201, the architecture and its last subsection "What this chapter freezes"; D-202 to D-208 for the TypeScript blocks the interfaces file copies. The design is frozen at `bd8780f7ad59a451035b15920c00015a2eee6e9b` of `defi-wonderland/mast-social-recovery-2` (see `docs/social-recovery/README.md`); the interfaces file records that commit in its header.
- `design/ux-interfaces.md` D-370 to D-376, what the extension consumes.
- `design/ux.md` D-300 (the string table as the copy-lint surface), D-310 (records in local storage), D-316 (ceremonies in a full tab, never the action popup).
- `design/ux-copy.md`, the bans UXC-1 to UXC-7 and UXC-9 and the requirement UXC-10 (the feature name is "Account recovery").
- Deltas that touch this task, from the task files: PT-035 delta 1 (twelve interfaces, not eight; the builder hands out `IMethodModuleReads` and `IRecoveryActionInteractor`), PT-035 delta 2 (record the `sdk.md` commit), PT-036 delta 2 (`en.json` holds five keys and the UI uses literals as keys, so this task defines how strings are registered).

## What the task builds

### 1. The module folder, one folder per lane

`src/web/modules/social-recovery/` with a `README.md` at its root and one folder per lane below. Every lane folder holds one `README.md` naming its task id and title and nothing else. The lanes, from the `Module (this repository)` row of every task file:

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
| `recovery/entry/` | PT-054 |
| `recovery/checklist/` | PT-057, PT-058, PT-059, PT-070 |
| `recovery/submit/` | PT-060 |
| `recovery/wait/` | PT-055, PT-061 |
| `recovery/done/` | PT-062 |
| `guardian-page/` | PT-063, PT-064 |
| `watcher/` | PT-065 |
| `cancel/` | PT-066 |
| `management/overview/` | PT-067 |
| `management/editor/` | PT-068 |

Two folders belong to this task alone and are frozen after it: `sdk-interfaces/` (item 2) and `routes/` (item 3). The module `README.md` states the lane map, the two frozen folders, and the import rule: a screen imports `shared/client`, never `sdk-doubles`; only `shared/client` and the tests of `sdk-doubles` import the doubles.

### 2. The SDK interfaces, mirroring D-201

`src/web/modules/social-recovery/sdk-interfaces/`, with an `index.ts` barrel; a split into one file per `sdk.md` section (D-202 interactors, D-203 events, D-204 codecs, D-205 descriptions, D-206 methods, D-207 gathering, D-208 builder and provider) is allowed. Every declaration is hand-written from the TypeScript blocks of `sdk.md` D-201 to D-208 and imported from no SDK package. The file header records the design commit `bd8780f7ad59a451035b15920c00015a2eee6e9b`.

The twelve interfaces D-201 freezes: `ISetupClient`, `IRecoveryClient`, `IMethodsOrchestrator`, `IPolicyManagerInteractor`, `IEventManager`, `IMethodModuleReads`, `IProvider`, `IRecoveryMethod`, `IActionCodec`, `IMethodCodec`, `IRecoveryActionInteractor`, `IRecoveryActionArming`. Beside them, every value record the frozen list names: the prepared call and the prepared batch, the two state records, the configuration and confirmation records, the module and action records, the add result and the assessment, the enrollment failure and the verdict, the three gathering records, the three descriptions, the two finding sets and the three restore causes, the deployment descriptor and the client configuration, and the refusal shapes (thrown errors with findings or a restore cause; typed results for `replyFrom`, `configFrom`, `addApproverReply` and the two verdict members).

Rules:

- Types only: `export interface`, `export type`, and `as const` objects for closed vocabularies. No function, no class, no runtime beyond those constants.
- Where `sdk.md` marks a block illustrative, copy its shape as written and add a one-line comment naming the section. Do not invent members. The three members cut-q-22 records (the verify per pasted reply, the removed-key read, the fit check on code-to-be) are not SDK members and do not go here; PT-035 scripts them in its own lane under an extension-owned seam.
- Privacy levels: mirror D-375 as written. Whether a screen shows two radios or three is a screen decision under cut-q-23, not this file's.
- Naming: keep the member names of `sdk.md` exactly, so PT-035's doubles and the real SDK meet on one shape.

### 3. Routes

`src/common/modules/router/constants/common.ts`, `WEB_ROUTES` gains:

| Key | Path | Surface |
| --- | --- | --- |
| `socialRecovery` | `social-recovery` | the module's mount point |
| `socialRecoveryCeremony` | `social-recovery/ceremony` | PT-041, the full tab a ceremony runs in |
| `socialRecoverySetup` | `social-recovery/setup` | the setup wizard, M-7 (frames C-01 to C-11) |
| `socialRecoveryCreate` | `social-recovery/create` | PT-042, the create door |
| `socialRecoveryRecover` | `social-recovery/recover` | PT-052, the recover door and the warning gate |
| `socialRecoveryFastTrack` | `social-recovery/fast-track` | PT-053 (frames A1-01 to A1-04) |
| `socialRecoveryRecovery` | `social-recovery/recovery` | PT-054 to PT-062 (frames D-01 to D-15) |
| `socialRecoveryApprove` | `social-recovery/approve` | PT-063 and PT-064, the guardian's approval page |
| `socialRecoveryCancel` | `social-recovery/cancel` | PT-066, the owner's cancel |
| `socialRecoveryManage` | `social-recovery/manage` | PT-067 and PT-068 |

`src/common/modules/router/config/routesConfig/routesConfig.ts` gains one entry per key; the mapped type requires it. The `title` is the feature name UXC-10 fixes, "Account recovery", and the `name` is the surface's own, taken from the frame captions in `design/frame-register.md` (for example "Recover an account", "Approve a recovery"). Titles go through `i18n.t` with keys from item 4.

`src/web/modules/router/components/MainRoutes/MainRoutes.tsx` gains one import and one line: inside the existing `<Route element={<TabOnlyRoute />}>` group and outside `KeystoreUnlockedRoute`, `<Route path={`${WEB_ROUTES.socialRecovery}/*`} element={<SocialRecoveryRoutes />} />`. This puts every recovery surface in a full tab through `tab.html`, D-316, and leaves the guards to the module, since the guardian page and the fast track run without a keystore.

`src/web/modules/social-recovery/routes/SocialRecoveryRoutes.tsx` is the module's own route registry: a `<Routes>` element that, at setup, holds two guard groups and no screens. The first group wraps `KeystoreUnlockedRoute` and `AuthenticatedRoute` for the owner's surfaces (setup, manage, cancel, create, recovery). The second group is open for `approve`, `fast-track` and `recover`. A comment beside each group names the keys that will mount there. A later task adds exactly one `<Route>` line for its screen in this file; the coordinator rebases same-round branches over each other. This is the one module-internal file more than one lane touches; the owner accepts or strikes it (see judgment calls).

### 4. String keys in `en.json`

`src/common/config/localization/translations/en.json` gains one nested object under the key `socialRecovery`. Inside it, one sub-object per M-6 lane and one for routes, with slug keys and the shipped English string as the value:

- `routes`: the titles and names of item 3.
- `status`: the closed chip vocabulary of D-302, a method in setup (not started, in progress, tested, not tested, test failed, test unavailable, not supported, not yet active, saved, live), a row in collection (not asked, waiting, declined, unanswered, complete, not needed, did not answer, stopped), an attempt (recovery in progress, waiting, execution due, stopped, cancelled) and the recovery status (set up, not set up, path locked, not active, cannot recover).
- `display`: the kit nouns under their screen words (recovery registry, recovery module, publisher, security stop, setup number, attempt number), the two password names (extension password, recovery password), the four approval values (new key, key being removed, payment, no payment, deadline), the name caveat of I-41, the hidden-value chip, the member-list count form, and the words "no payment".
- `ruleLines`: every line D-305 states, with `{{n}}` and `{{m}}` placeholders where the line carries a count.
- `writes`: the submitting state, the two readings of the failed state (D-319), the reverted cancel's reading (D-307), and the gas step's sentences (D-303, D-393, D-312).
- `ceremony`: the four verdicts and their causes, the cancelled and refused notes, the unreachable hand-off note, the relying-party mismatch note (D-316, D-372, D-314).
- `records`: the three death reasons of D-392 and D-393 (expired, void, setup changed) and the age line a resumed draft shows.

Sources, in order: the chapter sentence, then the exact frame string in `design/live-frame-strings.md` where a frame carries it. Every value obeys `design/ux-copy.md`. Keys hold no `:` and no `.` (i18next separators). `bg.json` is not touched; the fallback language serves it.

The rule after this task: a lane consumes keys and adds none. A lane that finds a missing string reports it to the coordinator, who adds it on this branch (before merge) or in a follow-up `chore/social-recovery-strings-<n>` PR (after merge) and re-pins the stack. This keeps `en.json` a file one task edits at a time.

### 5. The Jest alias mapper

`jest.config.js` gains a `moduleNameMapper` for the eight `tsconfig.json` path aliases (`@ambire-common`, `@contracts`, `@ambire-common-v1`, `@common`, `@mobile`, `@web`, `@benzin`, `@legends`), so a unit test under the module folder imports through `@web/...`. `testEnvironment` stays `node`; a test that needs a DOM declares `@jest-environment jsdom` in its docblock (`jest-environment-jsdom` is installed). No new dependency. The implementer runs `yarn test` before and after the change and reports both results, since open question 16 records that Jest is not run in CI today.

### 6. `.gitmodules`

The `url` of the `ambire-common` submodule changes from `git@github.com:ethereum/kohaku-commons.git` to `git@github.com:defi-wonderland/kohaku-commons.git`. The pointer stays at `29227cc7c13617ccbe0c8b737d1678d30c2c4047`. The scheme stays SSH, as today.

Pre-step, owner's approval required before the branch is cut: the fork `defi-wonderland/kohaku-commons` has `main` at `4fc9a7d`, two commits behind upstream `main` at `29227cc` and zero ahead. The pinned commit is not reachable from any branch of the fork, so `git submodule update` would fail for everyone. The coordinator pushes upstream `main` to the fork's `main` (a fast-forward) and creates `dev/wonderland` on the fork at `29227cc`. Both are pushes to a shared remote and wait for the owner's yes.

### 7. The import fence (proposed, strike if unwanted)

`.eslintrc.js` gains an `overrides` entry with `no-restricted-imports` so that files under `src/web/modules/social-recovery/**`, except `shared/client/**` and `sdk-doubles/**`, cannot import from `**/sdk-doubles/**`. This makes the rule of `docs/social-recovery/README.md` mechanical. It is a shared file, so only this task can add it.

## Allowed files

Implementer lane:

- `src/web/modules/social-recovery/README.md`, one `README.md` per lane folder above
- `src/web/modules/social-recovery/sdk-interfaces/**`
- `src/web/modules/social-recovery/routes/SocialRecoveryRoutes.tsx`
- `src/common/modules/router/constants/common.ts`
- `src/common/modules/router/config/routesConfig/routesConfig.ts`
- `src/web/modules/router/components/MainRoutes/MainRoutes.tsx`
- `src/common/config/localization/translations/en.json`
- `jest.config.js`
- `.gitmodules`
- `.eslintrc.js` (item 7 only)
- `docs/social-recovery/briefs/chore-social-recovery-setup.md` (this file rides the PR)

Tester lane:

- `src/web/modules/social-recovery/__tests__/**` (Jest, node environment)

Nothing else. No `package.json`, no `yarn.lock`, no manifest, no `webpack.config.js`, no `tsconfig.json`, no screen, no double.

## Interfaces and invariants

- The twelve interfaces of D-201 (item 2). No invariant is implemented here; the copy-lint test enforces the bans of `ux-copy.md` over the new string values (I-26 reads `Protected` out of every string).

## Dependencies and base

- Base: `dev/wonderland` at `603d819d7`. No task dependency.
- kohaku-commons PR: none. The pre-step of item 6 is a branch operation on the fork, not a change.
- Round 0 (PT-035, PT-036, PT-037, PT-040) pins the revision of this branch that the setup PR carries when it is marked ready; their briefs record that SHA.

## Test expectations

Jest, under `src/web/modules/social-recovery/__tests__/`:

- `copy-lint.test.ts`: walks every string value under `socialRecovery` in `en.json` and fails on any banned term of `ux-copy.md` (UXC-1 to UXC-7, UXC-9), word-bounded, `Protected` case-sensitive, the rest case-insensitive; also asserts that no key contains `:` or `.`.
- `routes.test.ts`: every `WEB_ROUTES` key starting with `socialRecovery` has a `routesConfig` entry, every path starts with `social-recovery`, and the paths are unique.
- `sdk-interfaces.test.ts`: imports the barrel through `@web/modules/social-recovery/sdk-interfaces` and asserts the exported `as const` vocabularies exist; the type surface is checked by `tsc`.
- `alias.test.ts`: one import through each of `@web/...` and `@common/...` resolves under Jest.

Commands observed on the final revision, from the task worktree: `yarn test`, `npx tsc --noEmit`, `npx eslint <changed files> --ext .ts,.tsx`, `yarn build:web:webkit` (the task's `check: build`), and `git submodule sync && git submodule update --init` after the commons pre-step. No Playwright spec: no runtime behaviour ships.

## Open questions, with owners

| # | Question | Owner |
| --- | --- | --- |
| 1 | Twelve interfaces, not eight; the builder never hands out `IPolicyManagerInteractor` or `IRecoveryActionArming`. This brief follows D-201; confirm. | sdk owner with ux owner |
| 2 | The `sdk.md` commit the interfaces freeze against: `bd8780f`, as copied. Confirm. | sdk owner |
| 14 | `en.json` as the copy-lint surface with slug keys under `socialRecovery` (item 4). Confirm the key scheme. | ux owner |
| 16 | Jest with the alias mapper in item 5; Playwright only where a done entry needs the runtime. Confirm. | ux owner |
| 23 | This task. | ux owner |

## Judgment calls for the owner

1. The module's route registry (item 3) is one file more than one lane touches. The alternative is one `MainRoutes.tsx` edit per task, which the rules forbid. Accept the registry or name another shape.
2. Slug keys with English values (item 4) break with the file's current convention, where the key is the literal. Accept or keep literals.
3. The import fence (item 7) adds a lint rule the user's list did not name. Accept or strike.
4. Item 3 registers routes for M-7 and later surfaces that do not exist yet. They resolve to nothing until a task mounts a screen. Accept or trim to `socialRecovery` and `socialRecoveryCeremony`.
5. The commons pre-step (item 6) pushes to `defi-wonderland/kohaku-commons`. Approve the two pushes or do them yourself.
