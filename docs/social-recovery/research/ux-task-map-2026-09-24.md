# UX task map, 2026-09-24

A planning map of the social recovery ux tasks of the provisional cut, written for the implementer. It reads the design, the cut and the Kohaku extension repository, and it edits nothing. Every claim names the task id and the design section it rests on. Where a task id appears it is provisional, so the title stands beside it.

## What this map read, and at which commit

- The ux chapter and its siblings on `origin/dev` at `bd8780f` of `defi-wonderland/mast-social-recovery-2`: `design/frontend/ux.md`, `ux-interfaces.md`, `ux-user-requirements.md`, `ux-user-stories.md`, `design/personas/P-1` to `P-6`, `design/offchain/sdk.md`, `design/onchain/contracts.md`, `design/invariants.yaml`, `design/scenarios.yaml`, `design/open-questions.yaml`, `rules/ux-copy.md`. `bd8780f` is the squash merge of PR #45 (`docs/tech-design-ux-r31`), merged 2026-09-24 at 12:18 UTC, so `dev` carries R-31, R-32 and the cut rulings of PRs #48 to #50. The local checkout of that repository still sits on the pre-squash branch at `6b93075`; its content is contained in `dev` (checked sentence by sentence and over `design-context`), so `dev` is the one text and the local branch is history.
- The cut at `352f91a` of `origin/docs/cut-provisional-spec-v1`, file `design-context/spec-v1/cut-provisional.yaml`, read with `git show`. Its `based_on.consumes` block names `frontend/R-29` as the ux round it consumed, so the cut predates R-30 (the frozen wireframes) and R-31 (the passkey proof of concept); cut-q-24 says so itself.
- PR #54 (`docs/ux-kohaku-smart-account-investigation`, open) and PR #47 (`docs/cut-provisional-spec-v1`, open), read through `gh pr view` and `gh pr diff`.
- `surfaces/frame-register.md` at commit `1733b22` of the wireframes and `design-context/spec-v1/ux/research/live-frame-strings-2026-09-22-r30.md`. The `.pen` file was not opened.
- `design-context/spec-v1/ux/research/passkey-rp-poc-2026-09-23.md` and the proof of concept itself in the extension worktree `.claude/worktrees/fork-sync-conflicts-c5b018`, branch `feat/passkey-rp-poc`, folder `src/web/poc/passkey-rp/`.
- The extension repository at `72922ab25` (`main`), in the worktree `.claude/worktrees/social-recovery-task-map-1ae368`, with the ambire-common submodule read from the main checkout at the same pinned commit `29227cc7c`.

Two subagents did the repository reading and the SDK cross-check; their evidence carries `path:line` references in the text below. What was verified by running a read-only command is marked as such in part 7.

The ux range holds 37 tasks: PT-035 to PT-070 and PT-075, "The recovered key's typed-data signing in the extension", which sits in the ux range at milestone M-8 under module `ux/signing`. Two tasks sit out of milestone order: PT-055 "The running-attempt band" is M-10 although it lives in the M-8 entry lane, and PT-075 is M-8 with no dependency at all.

## 1. The dependency graph as it stands

Every `depends_on` of the ux tasks names another ux task. No ux task depends on an sdk task, by the ruling PT-035's body records: "the ux assumes doubles until the sdk lands and no ux task depends on an sdk task".

Waves, where wave 0 holds every task with no ux dependency and wave n every task whose dependencies all sit in earlier waves:

| Wave | Tasks |
| --- | --- |
| 0 | PT-035 The SDK doubles, PT-036 Display rules and the status vocabulary, PT-037 The rule lines, PT-040 The wallet's records, PT-075 The recovered key's typed-data signing |
| 1 | PT-038 The client, the provider and the signer (035), PT-041 The ceremony tab and the method hosts (035, 036), PT-043 The presets and the blank start (040), PT-044 The path editor's operations (035, 037, 040), PT-047 The waiting period and the privacy step (036, 040), PT-048 The Recovery Card (036, 040), PT-052 The recover door and the warning gate (036) |
| 2 | PT-039 The shared write states and the gas step (036, 038), PT-042 The create door's picker and the settings entry (036, 038), PT-045 The editor's refusals and the rules panel (044), PT-046 The passkey row and the guardian row (038, 040, 041), PT-049 The review's lead and its trust list (036, 037, 038), PT-054 The recovery entry and the account step (036, 038, 040), PT-057 The checklist's rows (040, 041), PT-063 The approval page's reading (036, 038), PT-065 The watcher (038, 040) |
| 3 | PT-050 The review's doors, stop block and save gate (049), PT-053 The fast track's three steps (039, 040, 052), PT-056 The readout by privacy level (054), PT-058 The guardian row, its message and the paste check (057), PT-064 The approval page's signing and reply (063), PT-066 The banner and the owner's cancel (039, 065), PT-067 The overview and the dormant states (039, 040), PT-069 The passport and Aadhaar rows at enrollment (046) |
| 4 | PT-051 The arming save (039, 040, 050), PT-055 The running-attempt band (056, 066), PT-059 The deadline, the polls and the deaths (058), PT-068 The management editor and the review of changes (044, 049, 067) |
| 5 | PT-060 The submission confirmation (039, 059), PT-070 The identity rows at recovery (059) |
| 6 | PT-061 The wait and its endings (060) |
| 7 | PT-062 The done screen (037, 061) |

Eight waves. The longest chain is eight tasks, eight half-days, four working days on one seat: PT-035 → PT-041 → PT-057 → PT-058 → PT-059 → PT-060 → PT-061 → PT-062. It runs through the ceremony tab into the checklist lane and out through the submission, the wait and the done screen. The next chains are seven and six long and share the same spine, so the checklist lane is the critical path whatever else runs beside it. The five-long chains are PT-035 → PT-038 → PT-049 → PT-050 → PT-051 (the setup save), PT-035 → PT-038 → PT-054 → PT-056 → PT-055 (the entry) and PT-035 → PT-038 → PT-039 → PT-067 → PT-068 (management).

Tasks whose only dependencies are PT-035 or PT-036, which start the moment those two land: PT-038 (on PT-035 alone), PT-041 (on PT-035 and PT-036), PT-052 (on PT-036 alone). Four more start on the other wave-0 foundations alone: PT-043 (on PT-040), PT-044 (on PT-035, PT-037, PT-040), PT-047 and PT-048 (each on PT-036 and PT-040).

Fan-out, the number of direct dependents each task has: PT-040 has eleven (043, 044, 046, 047, 048, 051, 053, 054, 057, 065, 067), PT-036 nine, PT-038 seven, PT-039 five, PT-035 three, PT-037 three. Everything else has two or fewer. PT-035's three direct dependents understate its reach, since PT-038 and PT-041 carry it into every screen.

The bodies name dependencies the headers do not declare. The engine schedules from `depends_on`, so these are the places where a task will find a neighbour missing:

- PT-042 wires the settings entry "to the presets of PT-043"; it does not depend on PT-043.
- PT-051 "routes to the card of PT-048"; it does not depend on PT-048.
- PT-054 reuses "the condensed anti-scam warning of PT-052"; it does not depend on PT-052.
- PT-057 opens the gathering "over the readout's path and the handover of PT-053 or PT-054"; it depends on neither, and PT-056 (the readout) is not in its chain.
- PT-058 renders "the link to the approval page of PT-063"; it does not depend on PT-063.
- PT-067 renders "the recover an account entry of PT-054, the Recovery Card action of PT-048" and "shows the trust list of PT-049 first"; it depends on none of the three.
- PT-053 says "the account step and the readout of PT-054 to PT-056 follow", which is a reverse pointer, correct as a header.

## 2. Setup versus feature

The foundations are the seven M-6 tasks. Every later task imports at least one of them, and their `risk_reason` states what drifts if their shape drifts.

| Foundation | What it is | Downstream | What breaks if its shape drifts, in the task's own words |
| --- | --- | --- | --- |
| PT-035 The SDK doubles | in-memory doubles of eight SDK interfaces over one scripted chain record, `ux/sdk-doubles` | PT-038, PT-041, PT-044 directly; every screen through them | "a double that drifts from the chapter's shape teaches thirty screens the wrong seam" |
| PT-036 Display rules and the status vocabulary | value renderers, chip vocabulary, the screen word for every kit noun, the string table, `ux/shared/display` | nine direct dependents, every screen with a value | "a second truncation or a second status word here appears everywhere at once" |
| PT-037 The rule lines | a pure function from a path's shape to D-305's lines, `ux/shared/rule-lines` | PT-044, PT-049, PT-062, and through them PT-056, PT-068 | "rendered in five places from one function, and a wrong line tells a holder a lockout is a rescue" |
| PT-038 The client, the provider and the signer | the D-370 layer, the provider adapter, the signer facade, the audited-actions table, the digest-version check, `ux/shared/client` | seven direct dependents, every chain read and every prepared call | "the digest-version check it runs is what refuses a client built against another deployment" |
| PT-039 The shared write states and the gas step | the submitting and failed states, the gas check and deposit step, `ux/shared/writes` | PT-051, PT-053, PT-060, PT-066, PT-067, and every write through them | "a failed state that misreads a revert as a call never sent has the holder retry a call that cannot land" |
| PT-040 The wallet's records | the D-310 records in local storage, the six setup records, the recovery session and its five wipes, `ux/shared/records` | eleven direct dependents | "a record kept in a worker controller or read as a bare zero loses the holder's progress or reads a default as a fact" |
| PT-041 The ceremony tab and the method hosts | the full tab and the hosts for enroll, test access, create claim and health check, `ux/shared/ceremony` | PT-046, PT-057, and through them PT-069, PT-070 | "A ceremony run in the action popup dies on focus loss and a verdict folded into a skip reads a failed method as an untested one" |

Two feature tasks behave as foundations for one other lane. PT-044 "The path editor's operations" is reused whole by PT-068 "The management editor and the review of changes", and PT-052's warning gate is reused in condensed form by PT-054. PT-049's trust list is rendered again by PT-067 (re-authorize) and PT-068 (review of changes).

The screens are the remaining twenty-nine tasks: PT-042 to PT-070 less PT-044's shared role. PT-075 is neither a foundation nor a screen. It repairs an existing function in the account library and depends on nothing in the ux range, and part 6 says where that function lives.

## 3. Mock-first

PT-035 doubles eight interfaces: `ISetupClient`, `IRecoveryClient`, `IMethodsOrchestrator`, `IEventManager`, `IPolicyManagerInteractor`, `IProvider`, `IRecoveryActionInteractor` and `IRecoveryActionArming`, "hand-written from the TypeScript blocks of D-201 to D-208". Three facts about that list bound what the doubles can prove.

- `ux-interfaces.md` names no `I…` identifier at all; the eight names come from the cut, and they match the twelve `sdk.md` D-201 declares except that PT-035 omits `IMethodModuleReads`, `IRecoveryMethod`, `IActionCodec` and `IMethodCodec`. PT-041 lists `IRecoveryMethod` in its `interfaces`, which no double serves.
- `sdk.md` D-201 says the builder hands an integrator the action part "as `IRecoveryActionInteractor` and never as `IRecoveryActionArming`" and the manager part "as `IMethodModuleReads` and never as `IPolicyManagerInteractor`" (sdk.md line 325, repeated at 1600). Nine ux tasks list `IPolicyManagerInteractor` (PT-049, 050, 054, 055, 059, 061, 063, 065, 067) and PT-051 lists `IRecoveryActionArming`. A double of those two teaches screens a seam the real builder never exposes.
- Every TypeScript block in `sdk.md` is marked illustrative (lines 146, 244, 408, 765, 1491), and `ux-interfaces.md` line 3 says "Nothing here is frozen". The doubles therefore freeze a shape the sdk chapter has not.

Legend for the table: doubles = the PT-035 doubles plus a scripted extension provider and the extension runtime in Playwright, with nothing real behind them; SDK = the real M-3 to M-5 code (PT-017 to PT-033, PT-071 to PT-074); chain = a live or forked chain with the M-1 contracts deployed; passkey = a WebAuthn authenticator, virtual (the CDP virtual authenticator the proof of concept used) or real; MetaMask = a real second wallet extension; phone = a real phone with a document.

| Task | Completes against the doubles alone? | Needs beyond the doubles | `done` entries that pass only against the real thing |
| --- | --- | --- | --- |
| PT-035 The SDK doubles | yes, it is the double | nothing | none; its own judgment that every member "exists on its double with the parameter and return records D-202, D-203, D-206, D-207 and D-208 fix" can be judged only against a frozen SDK, which does not exist yet |
| PT-036, PT-037 | yes | nothing | none |
| PT-038 The client, the provider and the signer | yes | the real builder (PT-030) and the address pins of cut-q-7 to mean anything | the digest-version refusal and the four-read routing are real only with the SDK's `RecoveryKitBuilder` and a deployment; the test seat uses placeholder addresses "it names as such" |
| PT-039 The shared write states and the gas step | yes | the extension's own ethers provider, scripted | the revert reading with "the cause the receipt carries" is real only against a chain |
| PT-040 The wallet's records | yes, no SDK at all | the extension storage wrapper mocked in Jest | none |
| PT-041 The ceremony tab and the method hosts | no | passkey (virtual or real), the extension runtime for the tab rule, a phone for the hand-off | "the extension calls the authenticator itself, create at enrollment and get at a claim" and "reads the synced or device-bound kind from the ceremony's own flags"; "a hand-off to a phone reports its result when the tab returns" |
| PT-042 The create door's picker and the settings entry | no | Kohaku's own picker and a chain or fork with an Ambire v2 account, and PR #54's proof of concept first | "the picker selects the smart account by default and shows it beside the keys badged as controlled by the derived key's address, read from the account's privilege events" |
| PT-043, PT-044, PT-045 | yes | nothing (PT-044 runs `validate path` on the double) | none |
| PT-046 The passkey row and the guardian row | no | passkey for the row; MetaMask or the offline block for the guardian's signed challenge; the extension provider for code detection | the passkey creation and kind flags; "the access test whose challenge the guardian's wallet signs on this device or through the offline block" |
| PT-047 The waiting period and the privacy step | yes | nothing, but the third radio waits on cut-q-23 | none |
| PT-048 The Recovery Card | yes | the extension runtime for print, file and QR hand-off | none |
| PT-049 The review's lead and its trust list | yes | SDK metadata that "distinguishes an empty declaration from an absent one" (D-371) to be real | that distinction, which only the real `moduleInfo` reads prove |
| PT-050 The review's doors, stop block and save gate | yes against a scripted read | the "privilege read" of D-371 has no SDK member; `sdk.md` line 609 and 1728 decline to list the account's other entries | "the other doors render as the SDK returns them" cannot pass against the real SDK as it stands |
| PT-051 The arming save | no | chain or fork with the M-1 contracts, the ambire-common deployment call, and the SDK's fit check on a code-less account (FR13-ARMING-BATCH, sdk residue) | "after the batch lands the wallet re-derives the commitment"; "prepended with the account's deployment from the extension's own account library where the account holds no code" |
| PT-052 The recover door and the warning gate | yes | nothing | none |
| PT-053 The fast track's three steps | yes, no SDK | ambire-common keystore and derivation in Jest | none; the derived address at "the account's index plus the extension's offset" is testable against a scripted seed |
| PT-054 The recovery entry and the account step | yes | the read that names the key a recovery would remove is not yet an SDK member (cut-q-22); the four-state setup read has no SDK member | "the request builder's refusal" with "the reason the builder gives" |
| PT-055 The running-attempt band | yes | nothing | none |
| PT-056 The readout by privacy level | yes | SDK's real decrypt for "a bundle this build cannot read"; cut-q-23 for the third state | "a bundle this build cannot read renders update the wallet" |
| PT-057 The checklist's rows | no | passkey and a phone for the hand-off row | "a passkey row completes on this device or through the browser's hand-off to a phone in a full tab" |
| PT-058 The guardian row, its message and the paste check | yes as written | the real `addApproverReply`, whose shape in `sdk.md` D-207 (a typed result with five refusals, never thrown, line 1538) differs from D-374's three thrown errors; the verify member of cut-q-22 | "a pasted approval validates at once through addApproverReply with four written errors" passes on the double and may not on the SDK |
| PT-059 The deadline, the polls and the deaths | yes | a chain for the polls to be real | none as written |
| PT-060 The submission confirmation | yes, less one clause | the SDK has no "uncertified-key warning" (no certification exists in `sdk.md`) | "the uncertified-key warning as one line where the SDK raises it" can pass on no real thing |
| PT-061 The wait and its endings | yes | chain for `execute now` to land | none as written |
| PT-062 The done screen | yes | ambire-common accounts controller to "add the recovered account to the wallet" | none |
| PT-063 The approval page's reading | yes | the extension runtime serving the page at a relative path | none |
| PT-064 The approval page's signing and reply | no | MetaMask over its externally connectable port, WalletConnect from an extension origin (untested, FR31-IMPL-CHECKS), the offline block | "the guardian signs the signingInput in their own wallet, injected or over WalletConnect, or offline" |
| PT-065 The watcher | yes | the background worker for the alarm and the locked state | "runs while the extension is locked and badges then" needs the runtime, not the SDK |
| PT-066, PT-067, PT-068 | yes | chain for the cancel and the writes to land | none as written |
| PT-069 The passport and Aadhaar rows at enrollment | no | a phone able to read a passport chip and the zkPassport flow; an Aadhaar QR and the pinned authority key (Q-22 says current documents fail against it) | "verifies against the on-chain verifier's pinned key"; "runs a test proof against the pinned authority key" |
| PT-070 The identity rows at recovery | no | the same phone and documents | "produces the full proof with progress" |
| PT-075 The recovered key's typed-data signing | no, and it uses no double | a fork of the pinned Ambire v2 account, and the `recovered-signing-wrapper` vector row of I-21, which cut-q-5 leaves without a blessed producer | both judgments |

Count: 28 tasks complete against the doubles alone (PT-035 to PT-040, PT-043 to PT-045, PT-047 to PT-050, PT-052 to PT-056, PT-058 to PT-063, PT-065 to PT-068). Nine need something real: PT-041, PT-042, PT-046, PT-051, PT-057, PT-064, PT-069, PT-070 and PT-075. Of the 28, four carry a `done` clause that no real thing satisfies today (PT-035's frozen records, PT-050's doors read, PT-058's error shape, PT-060's uncertified-key warning), and those four are the places where the doubles are most likely to teach a wrong seam.

## 4. Blocked on other departments or decisions

Nothing the ux consumes is frozen. `ux-interfaces.md` line 3: "Nothing here is frozen." `ux.md` D-300: "The chapter freezes no interface yet." `sdk.md` opens D-202, D-203, D-204, D-206 and D-208 with a "Freezes …" line (lines 541, 696, 841, 1207, 1596), and line 48 makes every freeze wait on the ownership table in `design/PRD.md` and on "every blocking open question whose answer shapes a format declared here"; Q-8 is that blocking question, waived on 2026-09-07. The PRD ownership table has not recorded them.

Unresolved decisions that touch the ux tasks:

- cut-q-23 (PR #47): "Shape visible waits on the sdk chapter's adoption of the middle privacy level, and the privacy step and the readout render two radios and two states until it lands. Blocks PT-047 and PT-056." `sdk.md` on `dev` names no third level; its model is a privacy dial over `publicMetadata` and a backup that is encrypted, clear or empty (lines 441, 592, 925), and the format of the public metadata is an open sdk question (line 1778). The reach is wider than the two tasks: PT-035 scripts "each privacy level" of three, PT-048 and I-32 say "the two hidden levels", I-25 (held by PT-047) says "one line for each of the three levels", D-318 and D-306 on `dev` describe three levels with no two-radio fallback, and the frozen frames C-06e and D-06 draw three radios and a "shape visible" readout. Where a frame and a sentence differ the chapter is the rule (D-312, 2026-09-23), and here the chapter and the cut differ.
- cut-q-22 (PR #47): the sdk owner decides whether `addApproverReply` refuses a reply whose local verdict fails, or whether the page verifies before filing. PT-035 scripts "the verify per pasted reply, the read naming the key a recovery would remove and the fit check against the code the account will carry" under this key, so PT-050, PT-051, PT-054, PT-058 and PT-060 all build against a member that does not exist.
- PR #54 (open): a proof of concept in the extension answers four questions "before the minimal setup's tasks materialize", so every M-7 task waits on it (PT-042 to PT-051), and PT-042 names it in its body. The cut dropped cut-q-27 on the strength of this paragraph, which is not yet merged. Part 6 says what the extension code answers today.
- cut-q-24 (PR #47): answered by the passkey proof of concept; the passkey tasks PT-041 and PT-046 "read the text before it", and a reconciling pass is owed. `dev` now carries R-31, so the text the tasks read is older than the chapter.
- cut-q-7 and cut-q-13, named in PT-038 and PT-047: the address pins of the deployed manager, methods and action, and the six waiting-period numbers of contracts D-107.
- FR13-ARMING-BATCH (D-314, D-371): the fit check on an account that has no code yet, asked of the sdk chapter; `sdk.md` on `dev` does not name it.
- FR23-SDK-VERIFY (D-373): the verify member the checklist's paste check and the submission gate need; `sdk.md` dispatches no verify.
- FR31-IMPL-CHECKS (D-312, 2026-09-23): typed data over MetaMask's port, WalletConnect from an extension origin, and the iPhone hybrid routes stay implementation checks of PT-064, PT-041 and PT-046.
- Q-22: whether the two identity methods work for a legitimate holder at the showcase; the Aadhaar pinned key is the 2021 certificate. PT-069 and PT-070.
- Q-13 and D-376: the watcher's schedule is the integrator's; PT-065 reads at `latest` where `sdk.md` line 1629 defaults its filters to `finalized`, a deliberate override the chapter states.

Per task:

| Task | SDK sections consumed | Frozen | Decisions that touch it | Verdict |
| --- | --- | --- | --- | --- |
| PT-035 The SDK doubles | D-370, D-371, D-373, D-374, D-375; D-202, D-203, D-206, D-207, D-208 | no | two interfaces the builder never hands out; `IMethodModuleReads` and `IRecoveryMethod` missing; cut-q-22; cut-q-23 | risky, not blocked: the doubles are the mock, but their member list must be settled with the sdk owner first |
| PT-036 Display rules | none | n/a | the payment order renderer and the "stopped" chips are second-release words (D-302, D-393) | free |
| PT-037 The rule lines | none | n/a | none | free |
| PT-038 The client | D-370, D-373; D-202, D-208 | `IProvider`'s four reads are the one normative list (sdk.md 1638 to 1643); the builder is illustrative | cut-q-7 address pins; no sponsor rail in the first release | risky |
| PT-039 Write states | D-373 (no balance, no estimate) | n/a | none | free |
| PT-040 Records | D-370, D-310 | n/a | the inventory record belongs to the second-release wizard (D-305), harmless | free |
| PT-041 Ceremony tab | D-372; D-206 | no | cut-q-24 reconciliation; FR31 iPhone routes; the health-check host it builds serves a third-release feature (D-313); 1Password refused the extension relying party | risky |
| PT-042 Create door | none from the SDK; contracts D-105 | n/a | PR #54's four questions; the create flow adds only an EOA today (part 6) | blocked until the proof of concept lands |
| PT-043 Presets | none | n/a | none | free |
| PT-044 Editor | D-371 `validate path`; D-202 | no | none | free |
| PT-045 Refusals | contracts D-103, D-107 | n/a | cut-q-13 for the waiting-period width | risky, small |
| PT-046 Passkey and guardian rows | D-372; D-206 | no | cut-q-24; FR31; the guardian's signed challenge route | risky |
| PT-047 Waiting period and privacy | D-375; contracts D-107, D-110 | no | cut-q-23; cut-q-13; I-25's three-level wording | blocked for the third radio, free for the rest |
| PT-048 Recovery Card | none | n/a | cut-q-23 only through "the two hidden levels" | free |
| PT-049 Review lead and trust list | D-371 metadata; D-202 | no | the empty-versus-absent declaration distinction is an SDK promise | risky, small |
| PT-050 Doors, stop block, save gate | D-371 privilege read; contracts D-105, D-108, D-110, D-111 | no, and the privilege read has no SDK member | cut-q-22 for the removed-key read; `sdk.md` declines the doors list | blocked for the doors, free for the gate and the stop block |
| PT-051 Arming save | D-371, D-375; D-202; contracts D-102, D-105, D-110, D-111 | no | FR13-ARMING-BATCH; cut-q-22; PR #54 question 2 (counterfactual deployment inside the batch); `IRecoveryActionArming` is never handed out | blocked |
| PT-052 Recover door | none | n/a | none | free |
| PT-053 Fast track | none from the SDK; contracts D-105 | n/a | none; I-43 cites an SDK certification the sdk chapter does not define | free |
| PT-054 Entry and account step | D-371, D-373; D-202 | no | cut-q-22 (removed-key read); the four-state setup read has no SDK member | risky |
| PT-055 Running-attempt band | D-371 `isAuthority`; D-202 | no | none | free |
| PT-056 Readout | D-371, D-375; D-202 | no | cut-q-23 | blocked for the third state |
| PT-057 Checklist rows | D-373, D-392; D-202, D-206 | no | phone hand-off untested on iPhone | risky |
| PT-058 Guardian row and paste check | D-374; D-202, D-206; contracts D-104 | no | cut-q-22; the D-207 result shape differs from D-374; FR23 | blocked on the error shape |
| PT-059 Deadline, polls, deaths | D-373; D-202, D-205 | no | its `done` names "a watch offer", which D-392 puts in the second release | risky, small |
| PT-060 Submission | D-373; D-202 | no | the uncertified-key warning does not exist in `sdk.md` | risky |
| PT-061 Wait and endings | D-371, D-373; D-202 | no | the cancel-by-proofs terminal is drawn for a road no release gathers (D-312) | free |
| PT-062 Done screen | D-203 consume event | no | none | free |
| PT-063 Approval page reading | D-374, D-376; D-202, D-206 | the three orchestrator names are normative (sdk.md 110, 1207) | the page's chain reads have no sanctioned route, since the builder hands out `IMethodModuleReads` alone | risky |
| PT-064 Approval page signing | D-374, D-376; D-206 | as above | FR31 (MetaMask typed data, WalletConnect); no WalletConnect package in the extension | blocked on the wallet route check |
| PT-065 Watcher | D-371, D-374, D-376; D-202, D-203 | no | Q-13; the `latest` override | risky |
| PT-066 Banner and cancel | D-370, D-373; D-202 | no | none | free |
| PT-067 Overview | D-371; D-202, D-203 | no | the re-authorize is a re-commit (D-312, 2026-09-18 and 2026-09-23); its frame G-01 states the older reason | free |
| PT-068 Management editor | D-371 prepare update and remove; D-202 | no | none | free |
| PT-069 Identity rows at enrollment | D-372, D-375; D-206; contracts D-104 | no | Q-22; the four zkPassport facts the ux asks the sdk to pin, which `sdk.md` line 1388 hands to the integrator instead | risky |
| PT-070 Identity rows at recovery | D-372; D-206 | no | Q-22 | risky |
| PT-075 Typed-data signing | none; contracts D-105, D-108 | n/a | PR #54 question 4 (which signing paths fail at privilege value 1); cut-q-5 (who produces and blesses the vectors) | blocked on the vector row |

Second-release items a task body still names, beyond the ones above: PT-036's chips include "stopped" and "did not answer" and its renderer takes a payment order; PT-040 and PT-069 name "the inventory"; PT-041 builds a health-check host; PT-059's done entry names a watch offer. Each is a sentence the implementer will build for a surface the first release never shows. Ten other tasks name a deferred item only to exclude it, which is correct.

## 5. Parallel lanes

Grouped by module path. Tasks in one lane share files; tasks in different lanes do not.

| Lane | Module paths | Tasks in order |
| --- | --- | --- |
| Foundations | `ux/sdk-doubles`, `ux/shared/{display,rule-lines,client,writes,records,ceremony}` | PT-035, PT-036, PT-037, PT-040 together; then PT-038, PT-041; then PT-039 |
| Onboarding | `ux/onboarding/{create,recover,fast-track}` | PT-042; PT-052 → PT-053 |
| Setup | `ux/setup/{presets,editor,enroll,privacy,card,review,arm}` | PT-043; PT-044 → PT-045; PT-046 → PT-069; PT-047; PT-048; PT-049 → PT-050; PT-051 |
| Recovery entry and checklist | `ux/recovery/{entry,checklist,submit,wait,done}` | PT-054 → PT-056 → PT-055; PT-057 → PT-058 → PT-059 → PT-070; PT-060 → PT-061 → PT-062 |
| Guardian page | `ux/guardian-page` | PT-063 → PT-064 |
| Watcher and cancel | `ux/watcher`, `ux/cancel` | PT-065 → PT-066 |
| Management | `ux/management/{overview,editor}` | PT-067 → PT-068 |
| Identity rows | none of their own: `ux/setup/enroll` and `ux/recovery/checklist` | PT-069, PT-070 |
| Signing | `ux/signing`, in fact the account library | PT-075 |

Tasks that touch two lanes:

- PT-044 the editor, in `ux/setup/editor`, is reused by PT-068 in `ux/management/editor`. PT-068 must not fork it.
- PT-049 the trust list is rendered by PT-067's re-authorize and PT-068's review of changes.
- PT-052 the warning gate is reused in condensed form by PT-054.
- PT-048 the card is routed to by PT-051 and offered by PT-067.
- PT-058 links to the page PT-063 builds in another lane, and the page reads the request PT-058's checklist mints.
- PT-055 lives in `ux/recovery/entry` but is M-10 and depends on PT-066 in the cancel lane.
- PT-069 (M-12) writes inside `ux/setup/enroll` after PT-046, and PT-070 (M-12) inside `ux/recovery/checklist` after PT-059. Neither may run while its lane's earlier task is in flight.
- PT-042 edits Kohaku's own create door and picker, which live outside every ux module (part 6).
- PT-075 edits the account library, which is a submodule and a third repository (part 6).

A dispatch order that keeps at most one task per module path in flight, following the waves of part 1. Within every round the module paths are distinct, so the round can run fully in parallel:

| Round | Dispatch | Seats |
| --- | --- | --- |
| 0 | PT-035, PT-036, PT-037, PT-040, PT-075 | 5 |
| 1 | PT-038, PT-041, PT-043, PT-044, PT-047, PT-048, PT-052 | 7 |
| 2 | PT-039, PT-042, PT-045, PT-046, PT-049, PT-054, PT-057, PT-063, PT-065 | 9 |
| 3 | PT-050, PT-053, PT-056, PT-058, PT-064, PT-066, PT-067, PT-069 | 8 |
| 4 | PT-051, PT-055, PT-059, PT-068 | 4 |
| 5 | PT-060, PT-070 | 2 |
| 6 | PT-061 | 1 |
| 7 | PT-062 | 1 |

Eight rounds of a half-day each, four days with enough seats. Two constraints cut across that order. PR #54 says no M-7 task materializes before the proof of concept, which holds rounds 1 to 4's setup and create-door tasks (PT-042 to PT-051) until it lands, while the M-8 entry and checklist chain, the guardian page, the watcher and the management overview can proceed. And the milestone order M-6 to M-12 puts PT-042 to PT-051 before PT-052 to PT-062, which the graph does not need. If milestones are dispatched in order, the critical chain through the checklist starts only after the setup milestone and the whole plan stretches to about six rounds of M-7 followed by the eight-long M-8 chain. On one seat the plan is 37 half-days whatever the order.

## 6. Fit against this repository

The extension repository at `72922ab25` was read in the worktree; the ambire-common submodule is not initialized there (`git submodule status` prints `-29227cc7c…`), so its files were read from the main checkout at the same commit.

**No `src/ux` exists, and every task body names one.** `src/` holds `ambire-common` (the submodule), `benzin`, `common`, `legends`, `type-declarations` and `web`. The house convention for a feature is `src/web/modules/<kebab-name>/{screens,components,hooks,contexts,utils}`, with nested modules as in `src/web/modules/auth/modules/create-seed-phrase`. The path that fits is `src/web/modules/social-recovery/` with one sub-module per lane (`onboarding`, `setup`, `recovery`, `cancel`, `guardian-page`, `management`, `watcher`) and `src/web/modules/social-recovery/{sdk-doubles,shared}` for the M-6 foundations. Routes go into `WEB_ROUTES` in `src/common/modules/router/constants/common.ts` and `MainRoutes.tsx`. Every task from PT-035 to PT-070 carries the mismatch; the engine derives the path allowlist from `module`, so the module values themselves need the repository's prefix or the allowlist needs a mapping.

**PT-075 names `src/libs/signMessage/signMessage.ts`, which is not in the extension.** The file is `src/ambire-common/src/libs/signMessage/signMessage.ts` in the submodule, where `wrapStandard` (line 75), `getPlainTextSignature` (line 498) and `getEIP712Signature` (line 554) sit, verified by reading the main checkout. The submodule's remote is `git@github.com:ethereum/kohaku-commons.git`, so PT-075 is a change in a third repository, then a pointer bump in the extension, then a pointer bump in the MAST repository. PT-075 carries this.

**D-310, records in local storage and never in a background controller: fits.** `src/web/extension-services/background/webapi/storage.ts` exports a `storage` wrapper over `browser.storage.local` (lines 28 to 52) that any extension page can import, beside ambire-common's `StorageController`. PT-040 should use the wrapper under namespaced keys and stay out of `MainController`, which `background.ts` builds at lines 376 to 399. Jest runs in a node environment, so the test seat must mock `browser.storage`.

**The ceremony tab as a full tab: fits.** Three HTML entries render the same bundle: `index.html` (the popup), `action-window.html` and `tab.html` (`webpack.config.js` 456 to 473). `getUiType()` in `src/web/utils/uiType.ts` tells them apart, `openInternalPageInTab()` in `webapi/tab.ts` (lines 118 to 145) opens `tab.html#/<route>`, and `<TabOnlyRoute>` (`src/web/modules/router/components/TabOnlyRoute/TabOnlyRoute.tsx` 21 to 31) forces a route out of the popup. D-316's "a hidden tab dispatches nothing to the background" is already the code's behaviour: `backgroundServiceContext.tsx` lines 84 to 85 block every dispatch while `document.hidden` outside the action window. PT-041 and PT-063 fit; the guardian page can be a `TabOnlyRoute` or a static page copied by webpack the way the proof of concept's pages are.

**The request queue: fits.** ambire-common's `RequestsController` (`src/controllers/requests/requests.ts` 79, `addUserRequests` 233) and `ActionsController` (`actions.ts` 57, `openActionWindow` 309) are the queue D-316 names; the UI side is `src/web/modules/action-requests`, `sign-message` and `sign-account-op`. PT-038's signer facade sits over `KeystoreController` (`keystore.ts` 91) and `src/libs/keystoreSigner/keystoreSigner.ts`; key types are `internal`, `trezor`, `ledger`, `lattice` (`interfaces/keystore.ts` 109 to 144). No WebAuthn signer exists and none is needed, since a passkey is a recovery method and not a keystore key.

**The manifest public key and `externally_connectable`: partly fits, and the one-key rule is not yet true.** `src/web/public/manifest.json` hardcodes a `key` at line 31; `processManifest` in `webpack.config.js` (lines 125 to 127) overwrites it with `BROWSER_EXTENSION_PUBLIC_KEY` on webkit builds when the variable is set, and gecko gets no key (line 124). Three extension ids are in play today, derived from the three keys: the manifest's default `cpiibjfeodhfpeidbhiidfppndhaedkl`, the main checkout's `.env` `limpbjkfopfcbfekngcglncigokbmnli`, and the proof of concept's `.env` `cgjhdpkjghcgpplimocodhjgcceglpoj`, the one whose rp id hash the proof recorded. D-312 (2026-09-23) rules one store-listing key for every holder-facing build, "set through the build configuration the extension already reads"; the mechanism exists, the value is not fixed. `externally_connectable: { ids: ["*"] }` is present (manifest line 22 to 24) and removed on gecko and safari (webpack 106 to 108); that entry lets other extensions connect to Kohaku, while the guardian page connects out to MetaMask through MetaMask's own port, which the proof proved works. PT-041, PT-046 and PT-064 carry these.

**Library versions actually pinned.** `ethers` 6.13.4 exact and `viem` 2.33.3 exact match D-370 (`package.json` 138, 244); ambire-common pins `viem` 2.33.2 and `ethers ^6.8.0`. `react-native-qrcode-svg` is `^6.3.15` resolving to 6.3.20 and `@ambire/signature-validator` is `^1.0.3` resolving to 1.5.0, both ranges rather than the pins D-370 implies. No WalletConnect or `@reown` package exists in the extension's `package.json` or `yarn.lock`; ambire-common lists only `@walletconnect/client ^1.7.1` as a peer dependency, which is the v1 protocol. D-370's sentence that `@reown/appkit` 1.8.24 or `@walletconnect/universal-provider` 2.25.0 is "matched to what ambire-common already imports" does not hold. PT-064 carries it.

**The i18n tables as the copy-lint surface: does not exist yet.** `src/common/config/localization/translations/en.json` holds five keys; the UI calls `t('English literal')` 821 times under `src/web` with the literal as the key and i18next falling back to it. No i18n lint exists in the repository. In the MAST repository `.harness/config.yaml`'s `surfaces.files` names only `surfaces/social-wireframes.pen`, on `dev` and on the local branch alike, so D-300's sentence that the extension's string tables are named there describes work not done. PT-036 writes the string table; every screen task ships strings; the lint has no surface to read.

**The create door and picker: the shipped code differs from D-316's assumption more than the chapter says.** `GetStartedScreen.tsx` (lines 59 to 75) sends "Create new account" to `createSeedPhrasePrepare`, and the picker controller then auto-adds the first account that is not a smart account (ambire-common `accountPicker.ts` 970 to 975, with `DEFAULT_SHOULD_ADD_NEXT_ACCOUNT_AUTOMATICALLY = true` at line 60 and a TODO at 953 about excluding smart-account keys). The picker screen `src/web/modules/account-picker/` exists and its controller derives an EOA and a smart account per slot (lines 1035 to 1110, using `SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET`), but the create flow never shows it. So PR #54's question 3 reads "the picker exists for the import flow and is skipped on create", and question 1 reads "no, create adds an EOA". PT-042 carries this; its "two changes to Kohaku's own onboarding" are more than a default and a badge.

**The watcher's alarm: a precedent exists.** PT-065 says the watcher is "its first browser alarm"; `src/web/extension-services/background/controllers/auto-lock.ts` already uses `browser.alarms` (lines 60 to 71), and `processManifest` adds the `alarms` permission on every target (webpack 110). PT-065 can copy that pattern rather than introduce the API.

**Jest and Playwright as hosts for the tasks' checks.** `jest.config.js` spreads the submodule's config (ts-jest, node environment), ignores the submodule and e2e folders, has no `moduleNameMapper` for the `@web/*` and `@common/*` aliases and no jsdom; one test exists outside the submodule (`src/web/modules/PPv1/transfer/utils/formatAmount.test.ts`, relative imports). A new `*.test.ts` under `src/web/modules/social-recovery` is picked up by default but must stay node-safe or the config must gain a mapper. No CI workflow runs `yarn test`, lint or a type check. Playwright lives in `e2e-playwright-tests/` (`testDir: 'tests'`, `**/*.spec.ts`), loads `build/webkit-prod` with `--load-extension`, seeds storage from `BA_*` and `SA_*` secrets when `IS_TESTING=true`, and its workflow skips itself when the `DEPLOY_KEY` secret is absent. So the "test seat" of every task can write Jest for the pure parts and Playwright for the runtime parts, but nothing runs the former in CI and the latter needs secrets. The harness check ids do not fit either: `check: build` is defined in `tasks/README.md` as "compiles against the declared interfaces", and `check: fuzz` maps to `fuzz_budgets` in `.harness/config.yaml`, which are Foundry profiles (`runs`, `depth`, a pinned seed). Eleven ux tasks carry `check: fuzz, budget: deep` because they are `risk: high` (PT-050, 051, 053, 054, 058, 059, 061, 064, 065, 066, 067), and no TypeScript fuzz runner exists for them.

**The MAST submodule of D-316: not set up.** The MAST repository has no `.gitmodules` and no gitlink on `dev`. The two-pull-request flow the chapter describes starts only once the extension is added at a pinned commit.

## 7. Machine and repository setup

Verified by running a read-only command on this machine on 2026-09-24:

- `node --version` v22.14.0, inside the engines range `>=22.12.0 <23.0.0`; `.nvmrc` says 22.12.0. `yarn --version` 1.22.17; `npm --version` 11.3.0.
- The worktree has `node_modules` (1562 entries), no `.env`, an empty `src/ambire-common`, and no `e2e-playwright-tests/node_modules`. The main checkout has a `.env` with every key of `.env-sample` and `BROWSER_EXTENSION_PUBLIC_KEY` set, and `src/ambire-common/node_modules` (748 entries).
- `git submodule status` in the worktree: `-29227cc7c… src/ambire-common`, not initialized. The pinned commit is on `origin/main` of `ethereum/kohaku-commons`.
- The proof-of-concept branch `feat/passkey-rp-poc` is five commits ahead of `main` and zero behind (`0ffd6a7ab` to `3af7f66b4`), exists only in the fork-sync worktree, and `git ls-remote --heads origin feat/passkey-rp-poc` is empty: it is unpushed. That worktree also carries an uncommitted submodule pointer move to `c12ccead0`.
- No `mast` command was run and no build wrote into `build/`. Python here has no PyYAML; the wave computation used a plain parser over the cut file.

Read from the files, not run:

- Install: `yarn install` (root, with `postinstall: patch-package`), then `cd src/ambire-common && npm install` per `README.MD` line 45; CI never runs the second step and reaches the submodule through babel and tsconfig aliases.
- Dev build: `yarn web:webkit`, which removes `build/webkit-dev` and starts `expo start --web` with `WEB_ENGINE=webkit`; prod build `yarn build:web:webkit` into `build/webkit-prod`, which Playwright loads.
- Tests: `yarn test` runs `jest --config=./jest.config.js --passWithNoTests` and needs the submodule initialized, since line 2 of the config requires the submodule's config. Playwright: `cd e2e-playwright-tests && npm ci && npx playwright install chromium && npm run test`, after a webkit prod build, with the `BA_*`, `SA_*`, `KEYSTORE_PASS` and `IS_TESTING=true` variables the workflow shows.
- `.env` keys a build validates (`scripts/validateEnv.js`, unless `IS_TESTING=true`): `RELAYER_URL`, `VELCRO_URL`, `BROWSER_EXTENSION_PUBLIC_KEY`, `REACT_APP_PIMLICO_API_KEY`, `REACT_APP_ETHERSPOT_API_KEY`, `NFT_CDN_URL`, `LEGENDS_NFT_ADDRESS`, `LI_FI_API_KEY`. A missing `.env` fails the build. The README asks for `SEPOLIA_RPC_URL`, `ALCHEMY_API_KEY` and `HYPERSYNC_API_KEY` too.
- The proof of concept needs `KOHAKU_PASSKEY_POC=true` on a prod build, the same `BROWSER_EXTENSION_PUBLIC_KEY` as before so the extension id and the relying party stay the same, Chrome with a platform authenticator or a phone over hybrid transport, and MetaMask installed beside Kohaku.

What must exist before the first task starts, in order:

1. The submodule initialized and `npm install` run inside it, in whichever worktree hosts the work; without it neither Jest nor a type check runs.
2. A `.env` with the required keys and one agreed `BROWSER_EXTENSION_PUBLIC_KEY`, since three ids are in play and every passkey the tasks mint binds to one of them.
3. `feat/passkey-rp-poc` pushed, or at least its five commits preserved, since the design note cites it by branch and commit range.
4. The `src/web/modules/social-recovery` convention agreed, or the tasks' module paths changed, before PT-035 to PT-041 write files.
5. A decision on what `check: build` and `check: fuzz` run for a ux task, since the harness knows only Foundry fuzz and the extension has no CI test run.
6. For PR #54's proof of concept: a chain or fork with an Ambire v2 account created through the shipped create door, a funded key, and the M-1 contracts if question 2 is to be answered inside a real arming batch; questions 1 and 3 need only the extension.
7. For the persona replays D-301 on `dev` asks for once per milestone: an iPhone on iCloud (Sam, Carl, Bob), an Android phone (the proof's tested route), a phone that reads a passport chip (Diana), an Aadhaar QR, and MetaMask with a second seed for the guardian. The repository's Sepolia test wallet and Chrome profile serve the guardian role.

## 8. Missing information

Each item names the task, the sentence an implementer would have to guess at, and who owns the answer. None is answered here.

1. PT-035 The SDK doubles: "the eight interfaces the task declares". `sdk.md` D-201 declares twelve and hands an integrator `IMethodModuleReads` and never `IPolicyManagerInteractor`, and never `IRecoveryActionArming`. Which set the doubles imitate, and whether `IRecoveryMethod` (which PT-041 lists) joins it. Owner: the sdk owner @0xAaCE with the ux owner @FiboApe.
2. PT-035: "hand-written from the chapter's TypeScript blocks". Every block is marked illustrative and no freeze has landed in the PRD ownership table. Which commit of `sdk.md` the doubles freeze against. Owner: the sdk owner.
3. PT-047 and PT-056, and through them PT-035, PT-048 and I-25: cut-q-23. Whether the middle level exists, and until then whether I-25's "one line for each of the three levels" and D-318's three radios on `dev` are amended to two. Owner: the sdk owner for the adoption, the ux owner for the invariant and the chapter.
4. PT-050, PT-051, PT-054, PT-058, PT-060: cut-q-22. The verify member per pasted reply, the read that names the key a recovery would remove, and the fit check against the code the account will carry. Whether they become SDK members and under which names. Owner: the sdk owner.
5. PT-050 The review's doors: "the other doors render as the SDK returns them". `sdk.md` lines 609 and 1728 decline to list the account's other entries. Whether the extension derives the list itself over contracts D-108 or the review drops the doors. Owner: the sdk owner and the ux owner.
6. PT-058 and PT-060: "addApproverReply with four written errors" and "the uncertified-key warning where the SDK raises it". `sdk.md` D-207 returns a typed result with five refusals and never throws, and defines no certification. Which shape the paste check and the submission gate build against. Owner: the sdk owner.
7. PT-042 and every M-7 task: PR #54's four questions. The proof of concept has not run, PR #54 is not merged, and the shipped create flow auto-adds an EOA and never shows the picker. Who runs the proof, on which chain, and by when. Owner: the ux owner.
8. PT-051 The arming save: "prepended with the account's deployment from the extension's own account library" and FR13-ARMING-BATCH. Which ambire-common call produces the deployment, and whether the SDK's fit check will accept a code-less account. Owner: the sdk owner, with the design owner confirming at the review as D-314 says.
9. PT-038 The client: "the pins cut-q-7 owes". The addresses of the manager, the methods and the action on the test network. Owner: the contracts owner and the design owner.
10. PT-047 and PT-045: cut-q-13. The six waiting-period numbers of contracts D-107 that set the picker's ceiling. Owner: the contracts owner.
11. PT-064 The approval page's signing: "injected or over WalletConnect". No WalletConnect package is a dependency, and typed data over MetaMask's port and WalletConnect from an extension origin are untested (FR31-IMPL-CHECKS). Which package, and whether the first release ships WalletConnect at all. Owner: the ux owner.
12. PT-041, PT-046, PT-057: the iPhone routes Sam and Carl walk are untested, 1Password refused the extension relying party, and the high-`s` normalization the proof found has no named owner between the SDK passkey method (PT-029) and the extension. Owner: the ux owner and the sdk owner.
13. PT-041 and PT-046, D-312 of 2026-09-23: "the store listing's" manifest key. Which key, who holds it, and whether the demo build carries it now, given three ids in play. Owner: the ux owner with the publisher.
14. PT-036 and every screen: D-300's "the extension's i18n string tables are named under the `surfaces` block". The block names only the `.pen`, the tables hold five keys, and the code uses literals as keys. Whether every string goes into `en.json` and the harness block gains the file. Owner: the ux owner.
15. PT-050, 051, 053, 054, 058, 059, 061, 064, 065, 066, 067: "check: fuzz, budget: deep". The budgets are Foundry profiles. What a ux fuzz check runs, and what `check: build` compiles for the extension. Owner: the ux owner with the design owner, who holds the harness.
16. Every task's "test seat": whether it writes Jest (node, no alias mapper, not run in CI) or Playwright (needs a prod build and secrets), and how the persona replay D-301 asks for once per milestone is recorded. Owner: the ux owner.
17. Every task's `module`: `src/ux/...` against `src/web/modules/...`. Whether the module values change or the allowlist maps them. Owner: the ux owner.
18. PT-075: "the extension's `src/libs/signMessage/signMessage.ts`" is in the kohaku-commons submodule, and "the `recovered-signing-wrapper` vector row" has no blessed producer (cut-q-5). Which repository the change lands in and where the vector comes from. Owner: the ux owner and the sdk owner.
19. PT-041: the health-check host, for a feature D-313 puts in the third release. Whether the host is built now. Owner: the ux owner.
20. PT-059: "a watch offer" in its done entry, which D-392 puts in the second release. Owner: the ux owner.
21. PT-069 and PT-070: Q-22's re-check party and date, and the four zkPassport facts D-372 asks the sdk chapter to pin while `sdk.md` line 1388 hands the domain and scope to the integrator. Owner: the sdk owner for the facts, the design owner for Q-22.
22. PT-063: the page's three chain reads, when the builder hands out `IMethodModuleReads` alone. Which object the page reads `stateOf` and `isAuthorized` through. Owner: the sdk owner.
23. D-316's submodule: the MAST repository has no gitlink yet. Which commit the extension enters at, and whether the tasks' code lands on the extension's `main` or a long-lived branch. Owner: the ux owner.
24. The chapter text the tasks read: the cut consumed frontend/R-29, while `dev` at `bd8780f` carries R-31, R-32 and the cut rulings. The task bodies therefore predate the passkey findings, the re-authorize reason, the frozen wireframes and the no-cancel-set ruling, and cut-q-24 says a reconciling pass is owed. Which text the copied tasks bind to, and who reconciles the bodies with it. Owner: the ux owner.
25. The persona replay kit of part 7 item 7: who provides the phones and the documents, and whether a seventh Aadhaar persona is still owed (D-312, 2026-09-08). Owner: the design owner.
