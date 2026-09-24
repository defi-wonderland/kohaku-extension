# Social recovery kit

> The Ethereum Foundation asked for "a social recovery kit for the Kohaku wallet extension" with UX as a priority, to be delivered as contracts, an SDK and the recovery experience in the extension. `design/PRD.md § D-0` states the problem as an account holder who lost their signing key taking the account back through people or credentials they already hold. The tech design is under way, with the contracts chapter at `design/onchain/contracts.md` and the ux chapter drafted under `design/frontend/` against six personas under `design/personas/`, so this map is written for an agent handed the repository with one question about where the design decides a thing.

## Where the design decides

Each bullet names a question an agent is likely to be asked and ends where the design answers it.

- What the engagement builds, for whom, by when, and what the kit defends against is set in `design/PRD.md § D-0`.
- What must always hold is listed by heuristic in `design/PRD.md § D-1` and stated in testable form, entry by entry, in `design/invariants.yaml`.
- Which methods ship and how a helper's credential enters a rule is introduced in `design/PRD.md § D-2`, decided with the tiering and the dropped methods in `design/PRD.md § D-5`, and specified method by method in `design/onchain/contracts.md § D-104`.
- What one rule can express, and the single waiting period a setup carries, is decided in `design/PRD.md § D-5` and encoded as the setup body in `design/onchain/contracts.md § D-103`.
- How a recovery runs from the holder's request to the handover is told in `design/PRD.md § D-2` and specified from the contracts' side in `design/onchain/contracts.md § D-101`.
- The attempt's states and every transition between them are sketched in `design/PRD.md § D-2` and given in full in `design/onchain/contracts.md § D-103`, bound as `I-9` and `I-10` in `design/invariants.yaml`.
- Who can cancel a running attempt, and with which of the three paths, is decided in `design/PRD.md § D-2`, specified in `design/onchain/contracts.md § D-103` and stated as `I-7` and `I-8` in `design/invariants.yaml`.
- What a helper's proof signs, and why it counts for one recovery alone, is the binding digest of `design/PRD.md § D-3`, typed as two message types in `design/onchain/contracts.md § D-103` and bound as `I-11`, `I-12` and `I-13` in `design/invariants.yaml`.
- Which byte formats freeze as vectors is listed in `design/PRD.md § D-3` and demanded by `I-21` and `I-22` in `design/invariants.yaml`, while `design/kats/README.md` says how a vector file is written and none has landed.
- Which pieces make the kit, and what each is responsible for, is named in `design/PRD.md § D-4` and set out with its calls in `design/onchain/contracts.md § D-101`.
- Which kind of account the kit protects, and why an address upgraded through ERC-7702 is not one, is decided in `design/PRD.md § D-5`.
- Which account the demo runs on is decided in `design/PRD.md § D-5`, and the recovery action built for it is specified in `design/onchain/contracts.md § D-105`, whose subsection on the demo's account carries the privilege entry, the batch and the account's callback.
- What any account must provide to run an action is listed in `design/onchain/contracts.md § D-102`.
- Whether the policy manager executes anything on an account, or only approves, is decided in `design/PRD.md § D-5`, and the spend that releases an approval is specified in `design/onchain/contracts.md § D-103` and `design/onchain/contracts.md § D-105`, bound as `I-18` in `design/invariants.yaml`.
- What the chain learns about a setup, and where each credential's salt comes from, is decided in `design/PRD.md § D-5`, stated as `I-16` in `design/invariants.yaml`, and weighed salt path by salt path in `design/onchain/contracts.md § D-110`.
- What a holder on a fresh device rebuilds their setup from, and what its password costs them, is decided in `design/PRD.md § D-5`, and what the backup costs that holder on the default salt path is weighed in `design/onchain/contracts.md § D-110`.
- Which audited code the wallet method reuses is decided in `design/PRD.md § D-5` and applied in `design/onchain/contracts.md § D-104`.
- The policy manager's storage, verification order, interface, errors, structs and events are declared in `design/onchain/contracts.md § D-103`.
- What a method module may hold of its own, how the policy manager reads its verdict, and what it declares about the parties it trusts, is specified in `design/onchain/contracts.md § D-104`, bound as `I-4`, `I-5`, `I-14` and `I-15` in `design/invariants.yaml`.
- What committing an action means for the account, and what the recovery action's payload, batch and views contain, is specified in `design/onchain/contracts.md § D-105`, whose subsection on the demo's account lands each of them on Ambire's account, and bound as `I-17` in `design/invariants.yaml`.
- Who can change a kit contract after deployment is decided in `design/PRD.md § D-5`, answered contract by contract in `design/onchain/contracts.md § D-106`, and the pause a method can carry is specified in `design/onchain/contracts.md § D-111` and bound as `I-19` in `design/invariants.yaml`.
- Which numbers the contract enforces, and where every number a reader expects lives instead, is listed in `design/onchain/contracts.md § D-107`. The rule shapes the contract refuses on its own are specified in `design/onchain/contracts.md § D-103`.
- Whether the two identity methods work for a legitimate user at the showcase is `Q-22` in `design/open-questions.yaml`.
- Whether the opt-out from a method's stop should be per method rather than per setup is `Q-24` in `design/open-questions.yaml`, and the flag as it stands is specified in `design/onchain/contracts.md § D-111`.
- What the sdk chapter inherits from the contracts is listed in `design/onchain/contracts.md § D-108`.
- Which attacks and failures the design answers, and where, is `design/PRD.md § D-6` for the design as a whole and `design/onchain/contracts.md § D-110` for the risks the contract shapes add.
- What the watcher role does is described in `design/PRD.md § D-4` and bound as `I-20` in `design/invariants.yaml`, and where a holder's alert comes from is `Q-13` in `design/open-questions.yaml`.
- Who pays for a keyless holder's submission is `Q-5` in `design/open-questions.yaml`, and what the payment order commits the account to is specified in `design/onchain/contracts.md § D-103` and `design/onchain/contracts.md § D-107`.
- What a recovery reveals about the helpers who approved it is decided in `design/PRD.md § D-5` and weighed in `design/onchain/contracts.md § D-110`, and that a full proof set arrives in one act is `I-9` in `design/invariants.yaml`.
- What the integrator's screens must render that no contract checks is `Q-8` in `design/open-questions.yaml`, and the standing the secondary methods keep after their known problems is decided in `design/PRD.md § D-5`.
- Which methods carry a pause, who holds it, what it reaches and how a holder commits at setup to keep an accepted attempt through it is specified in `design/onchain/contracts.md § D-111`, bound as `I-19` in `design/invariants.yaml`, and the stop mechanisms the design weighed and did not build are recorded in `design/future-work.md`.
- What production does about the same account on other chains is `Q-15` in `design/open-questions.yaml`.
- Which area owns which chapter, which id band and which interfaces is the table in `design/PRD.md § D-7`.
- What the engagement designed and does not build, including the consent mode the pause replaced, the pause oracle, the pause anyone can trigger and the action shape for an EIP-8130 keystore account, is recorded in `design/future-work.md`.
- What has to be answered before the interfaces freeze, and what waits for the showcase instead, is stated in `design/onchain/contracts.md § D-100`.
- Illustrative pseudocode of the main flows, which the sections override where they disagree, is `design/onchain/contracts.md § D-109`.
- What the extension owns, which doors its welcome screen offers and where a ceremony runs is set in `design/frontend/ux.md § D-316`.
- Whom the recovery screens serve, and which journey binds each fixture, is stated in `design/frontend/ux.md § D-301` and held file by file under `design/personas/` as `P-1` to `P-6`.
- How every value renders, which status chip a row carries and what each kit noun is called on a screen is fixed in `design/frontend/ux.md § D-302`.
- How a holder builds a recovery path, which shapes the editor refuses and how each method enrolls and tests is specified in `design/frontend/ux.md § D-305`.
- What the holder reads about every trusted party, every pause holder and every other door before the save is specified in `design/frontend/ux.md § D-317`.
- Which privacy levels exist, what the recovery password unlocks and what the Recovery Card carries is specified in `design/frontend/ux.md § D-318`, over the encoding `design/frontend/ux-interfaces.md § D-375` proposes.
- How a setup is armed in one batch is specified in `design/frontend/ux.md § D-319`, and how it is edited, disarmed and repaired while dormant is specified in `design/frontend/ux.md § D-309`.
- Which route a keyless holder takes from a fresh install into recovery is specified in `design/frontend/ux.md § D-303`.
- How a recoverer names the lost account and reads its setup at each privacy level is specified in `design/frontend/ux.md § D-306`.
- How the recoverer gathers one approval set under one deadline, and every state a row or a request takes, is specified in `design/frontend/ux.md § D-392`.
- What the guardian's page shows and what it asks before its sign action enables is specified in `design/frontend/ux.md § D-308`, over the payload `design/frontend/ux-interfaces.md § D-374` proposes.
- What the submission confirms, how the wait runs and how an execution ends or fails is specified in `design/frontend/ux.md § D-393`.
- Which cancel roads reach the screens, and what the watcher polls and renders, is specified in `design/frontend/ux.md § D-307`.
- What the wallet stores on the device, and what wipes each record, is stated in `design/frontend/ux.md § D-310`.
- What a passkey's relying party is, which rp id hash its config commits and which manifest key every holder-facing build carries is stated in `design/frontend/ux.md § D-314` and `design/frontend/ux-interfaces.md § D-372`.
- Which disclosure lands on which screen is listed in `design/frontend/ux.md § D-311`, and the banned and required user-facing strings are `rules/ux-copy.md`.
- What the ux chapter covers and leaves to others is stated in `design/frontend/ux.md § D-300`, and every call it carries from the imported work is recorded in `design/frontend/ux.md § D-312`.
- What the extension consumes from the sdk chapter is proposed read by read, the client and its host adapters in `design/frontend/ux-interfaces.md § D-370`, the setup and management calls in `design/frontend/ux-interfaces.md § D-371`, the method lifecycle in `design/frontend/ux-interfaces.md § D-372`, the recovery operations in `design/frontend/ux-interfaces.md § D-373`, the guardian payloads in `design/frontend/ux-interfaces.md § D-374`, the secrets in `design/frontend/ux-interfaces.md § D-375` and the one exposed surface in `design/frontend/ux-interfaces.md § D-376`.
- Which axioms hold a screen's naming and its honesty are `I-23`, `I-24`, `I-26`, `I-33`, `I-34` and `I-41` in `design/invariants.yaml`.
- Which axioms hold what a holder reads before arming, and what the wallet refuses to arm, are `I-25`, `I-31`, `I-32`, `I-35`, `I-37` and `I-46` in `design/invariants.yaml`.
- Which axioms hold what an approver and a submitter see are `I-27`, `I-38`, `I-39`, `I-40`, `I-43`, `I-44` and `I-48` in `design/invariants.yaml`.
- Which axioms hold the owner's side of a running recovery are `I-28`, `I-29`, `I-30`, `I-36`, `I-42`, `I-45` and `I-47` in `design/invariants.yaml`.
- Which requirement row and which story cover a vertical is the per-vertical table of `design/frontend/ux-user-requirements.md` beside the stories of `design/frontend/ux-user-stories.md`, listed vertical by vertical in [frontend](./frontend.md).

## Topics

Two topic files sit beside this index, and an agent asked why the design is like this reads the first of them.

- [decisions](./decisions.md) answers which question each design section settled, one line per section id, sorted so no entry needs a later one.
- [glossary](./glossary.md) answers what each term the ux chapter coins means and which section introduces it.
- [frontend](./frontend.md) answers which sections, requirement rows, stories, invariants and personas decide each ux vertical, what the extension consumes from the sdk chapter and which journey each persona walks.

## Read these as the authority

The files below decide, and a disagreement between this map and any of them is a defect in the map.

- `design/PRD.md` is the idea draft, sections `D-0` to `D-7`.
- `design/onchain/contracts.md` is the contracts chapter, sections `D-100` to `D-111`.
- `design/frontend/ux.md` is the ux chapter, sections `D-300` to `D-319` with `D-392` and `D-393`.
- `design/frontend/ux-interfaces.md` proposes what the extension consumes and exposes, sections `D-370` to `D-376`.
- `design/frontend/ux-user-requirements.md` is the requirement table, one section per vertical with its rows beneath and a closing section for every vertical at once.
- `design/frontend/ux-user-stories.md` is the story set, `D-350` to `D-368`.
- `design/personas/` holds the six fixtures the ux chapter answers to, `P-1` to `P-6`.
- `design/invariants.yaml` holds the axioms, each tied to a bug class and a mechanical check.
- `design/open-questions.yaml` holds what is undecided, each entry naming what depends on the answer.
- `design/kats/` holds the frozen vectors once they land, and today it holds its README alone.

## Do not infer

The record cannot support the claims below, and an agent is prone to make each of them.

- The idea prefix, `design/PRD.md` and `design/invariants.yaml` as imported, was admitted by attestation and never executed, reviewed or validated in this repository, so describe nothing here as having checked it, and `.harness/admission/spec-v1.json` carries the one provenance sentence you may give for it.
- No round, receipt, finding or pull request of the source repository is this engagement's evidence, so cite none of them.
- The imported idea is not a finished technical design, and nothing under `design/` is signed yet, so every section is a draft until the owner signs it.
- A round document under `design-context/spec-v1/` is trajectory and never evidence, and a position argued in one is not what the design says.
- No interface is frozen, since `design/PRD.md § D-7` records none and `design/onchain/contracts.md § D-100` names what the freezes wait on, so every declared function in the chapter is a proposal.
- No vector file exists under `design/kats/`, so every byte layout in `design/onchain/contracts.md` is the proposal a vector will freeze rather than frozen bytes, per `design/onchain/contracts.md § D-100`.
- The pause of `design/onchain/contracts.md § D-111` carries the shape the Ethereum Foundation confirmed, and `I-19` in `design/invariants.yaml` carries the status `assumed` rather than `grounded`.
- The contracts chapter names open confirmations about the demo account in `design/onchain/contracts.md § D-105`, so treat none of them as checked. Its match with ERC-7913 is not among them, since `design/onchain/contracts.md § D-104` carries that one with the date it was verified.
- An entry in `design/open-questions.yaml` is undecided, and its resolution field says what is owed rather than what was chosen.
- Nothing in `design/future-work.md` is committed to anyone or scheduled, so report none of it as work this engagement will do.
- No task exists and every invariant's `check_ref` is unassigned, so no check in `design/invariants.yaml` is implemented anywhere.
- The sdk chapter at `design/offchain/sdk.md` freezes no interface, its own `design/offchain/sdk.md § D-200` says so, so what the extension consumes from it stays a proposal on both sides until `design/PRD.md § D-7` records a freeze.
- The wireframes under `surfaces/` draw examples of the rules the chapter states rather than every state a screen can take, since the lines they render are generated from the holder's own path, `design/frontend/ux.md § D-305`, and a frame carries the code `design/frontend/ux.md § D-302` fixes.
- `design/frontend/ux-interfaces.md § D-370` opens a file that freezes nothing, so every call in it is a proposal handed to the sdk chapter rather than a signature the extension may build against.
- The personas under `design/personas/` bind the design as `design/frontend/ux.md § D-301` states, so a journey sentence in one of them is a claim to validate against the screens rather than background about a user.

## Optional

An agent short on context may skip the files below, and `design/personas/` is not among them.

- `surfaces/frame-register.md` lists every drawn frame under its code, reference material for an agent that needs the frame a rule was drawn on.
- The string dumps and the check scripts under `design-context/spec-v1/ux/research/` record the words the frames carry, which an agent asked about a screen's exact copy may open.
- `design-context/spec-v1/research/` holds research notes, some copied from the source archive and some written for this engagement, reference material rather than authority, and each note says on its own first lines which it is and when its sources were read.
- The round documents under `design-context/spec-v1/` and the living draft at `design-context/spec-v1/design-draft.md` record how the design got here, and a round is trajectory and never evidence.
- `HARNESS.md` and `AGENTS.md` are the harness's own rules, read by section when a rule seems arbitrary.
