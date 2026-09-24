# Social recovery

The design and the task split of the social recovery feature of the Kohaku extension, copied into this repository so the people and the agents that implement it read the text beside the code.

## Where the text comes from

The design was written in `defi-wonderland/mast-social-recovery-2`. That repository stays the design tool. The implementation runs here, on the branch `dev/wonderland`, one pull request per task, merged to `main` at the end.

Every file under `design/` is a verbatim copy from branch `dev` of that repository at commit `bd8780f7ad59a451035b15920c00015a2eee6e9b` (2026-09-24), with one exception: `design/ux.md` carries one extra paragraph in D-316, the proof-of-concept paragraph of pull request #54 of that repository, which was open at the time of the copy. The design is frozen at that commit. A correction to the design is a change in that repository first and a fresh copy here second, so this folder never drifts silently.

Every file under `tasks/` comes from `design-context/spec-v1/cut-provisional.yaml` at commit `352f91a` (pull request #47 of that repository). The ids `PT-035` to `PT-070` and `PT-075` are provisional. The cut was never materialized, so a task is named by its id and its title together.

## How to read it

1. `design/ux.md` is the ux chapter, sections D-300 to D-399. D-312 is the decision record with dated entries. Where any other text and the chapter differ, the chapter is the rule.
2. `design/ux-interfaces.md` (D-370 to D-376) names what the extension consumes from the SDK. `design/sdk.md` (D-200s) is the SDK design those interfaces rest on. `design/contracts.md` (D-100s) is the contract design.
3. `design/invariants.yaml` (I-23 to I-48 are the ux invariants), `design/scenarios.yaml` (S-01 to S-11), `design/open-questions.yaml` and `design/future-work.md` bind or defer what the chapter says.
4. `design/personas/` holds the six personas whose journeys are replayed by hand once per milestone. `design/ux-copy.md` is the copy rulebook every shipped string follows.
5. `research/frame-register.md` lists every wireframe with its code and band, and `research/live-frame-strings-2026-09-22-r30.md` holds every string of every frame. The wireframe file itself is not copied. Where a frame and a chapter sentence differ, the chapter is the rule.
6. `research/passkey-rp-poc-2026-09-23.md` is the passkey relying-party proof of concept run in this repository on branch `feat/passkey-rp-poc`, with its raw results beside it.
7. `research/ux-task-map-2026-09-24.md` is the task map: dependency waves, foundations, mock-first verdicts, blockers, lanes, the fit against this repository, the machine setup and the open questions. `research/ux-task-start-order.mmd` is its dependency graph.
8. `tasks/README.md` lists the 37 tasks by start round. Each task file holds the header, the done entries and the body verbatim, with `src/ux/...` rewritten to `src/web/modules/social-recovery/...`, and ends with the deltas found against the chapter at the commit above.

## Rules the implementation keeps

- Screens build and test against the SDK doubles of PT-035 until the SDK lands. Screens import the extension's own client layer (PT-038), never the doubles directly, so the swap to the real SDK touches one folder.
- The SDK interfaces the doubles imitate are the ones `design/sdk.md` D-201 declares. The builder hands an integrator `IMethodModuleReads`, never `IPolicyManagerInteractor`, and `IRecoveryActionInteractor`, never `IRecoveryActionArming`.
- Records live in the extension's local storage and never in a background controller (D-310).
- Ceremonies that die on focus loss run in a full tab, never in the action popup (D-316).
- Every holder-facing build carries one manifest public key (D-312, 2026-09-23), since the passkey relying party is the extension's own origin.
- Every shipped string follows `design/ux-copy.md`.

## Open decisions

The task map's part 8 lists 25 questions the tasks leave open, each with its owner. They are not answered here.
