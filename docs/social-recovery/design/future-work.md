# Future work

This file records work the engagement designed and then ruled out of scope, written for the partner's engineers and for whoever picks the work up later. Everything here is worked out but committed to nobody and scheduled for nothing, and none of it is part of the design this engagement signs. The kit's core does not depend on anything below.

## Why this record exists

The demo runs on Ambire's smart account, a decision the Ethereum Foundation took, and the contracts chapter carries the recovery action for it. This file records the paths the Ethereum Foundation did not choose and the designs worked out for them, so that a later decision can pick one up instead of starting over. It keeps the two other demo paths and what each would take, the account the engagement designed on OpenZeppelin's base with the account half of the recovery action it would need, the findings for a Safe action, the passkey signer handover no recorded action serves, and the delivery mechanism the core retired.

## Demo paths

The demo exists to prove the core end to end on one real account. Three paths were on the table, A, B and C, and the Ethereum Foundation chose B, the recovery action for Ambire's account as it is today, which the contracts chapter now carries. This section keeps what each path builds, proves and risks, so the two not taken can be picked up later. None of them changes the kit's other parts. The policy manager, the method modules, the SDK and the recovery screens are built and audited the same under every path, and the manager is identical byte for byte, since it never calls an account.

### An account the engagement builds

Path A, which the Ethereum Foundation ranks as nice to have, has the engagement build its own smart account, a factory to deploy it and the recovery action for it. The example account below is the worked design, an ERC-4337 account with the ERC-7579 module surface on OpenZeppelin's base. It proves the whole lifecycle, install, recovery and uninstall, on a stack the engagement controls, and every modular wallet that implements the same standard would integrate the same way.

It costs the largest contract surface of the three paths, an account and a factory audited to wallet grade on top of the kit's contracts, and the demo runs on accounts created for it rather than on accounts anyone already holds. Its risk is the size of the build and the audit. No external team is on the critical path, and the audit of the account and the factory is the longest task.

### An action for the partner wallet's account

Path B, the one chosen, has the engagement build the recovery action for Ambire's `AmbireAccount` as it is today, through the account's own external validator function, and build no account and no factory. D-105 of the contracts chapter is the design. It proves recovery on the partner's real wallet, on accounts that already exist and cannot be upgraded, with no module standard anywhere, which is evidence that the manager binds to a policy and not to an account standard. The chosen path also gave up the on-chain arming check path A had, since Ambire's account fires no hook at authorization, so the fit check runs in the setup screen alone.

It costs the most trust in one contract, since on this account a privilege write is total authority and the action's code is the only thing that protects the account, and the wallet team must take part, for the authorization entry and the paired install and uninstall batches. Its risk is the external dependency, since the wallet team's schedule and sign-off sit on the critical path. The build is the smallest of the three.

### A module surface added to the partner wallet's account

Path C has the wallet team add an ERC-7579 executor surface to Ambire's account, the one the Kohaku extension uses, so the kit's action installs there as a module, the same action path A uses. An engineering estimate on record calls that change an addition over the audited account rather than a rewrite, since the account already has an atomic batch executor, a fixed-slot storage pattern and a self-call authority model. That estimate is unverified. 

It proves what path A proves, on the partner's wallet. It costs a change to a deployed account implementation, which existing proxies cannot take in place, so it reaches new accounts only. Its risk is the wallet team's roadmap, since the change is theirs to ship.

### Side by side

| | Path A, own account | Path B, wallet action, chosen | Path C, wallet module surface |
| --- | --- | --- | --- |
| new contracts | account, factory, recovery action | one action | account change, recovery action |
| audit surface | account and factory at wallet grade | the action | the account change and the action |
| accounts in the demo | created for the demo | already deployed | new accounts only |
| external dependency | none | the wallet team | the wallet team |
| what it proves | the standard integration | the generality claim | the standard integration on the partner's wallet |
| main hazard | build and audit volume | coordination and action trust, and no on-chain arming check | the wallet's roadmap |

### What the choice does not decide

The manager, the method modules, the SDK and the recovery screens are built the same under every path. The two paths the Ethereum Foundation did not choose stay designed below, and the paths compose: the path B demo does not block a path A account later, and a path C account would take path A's action unchanged.

## Example account on OpenZeppelin

This section records the account path A would build, whole: the decision that picked its base, the standards it speaks, its door, its factory, and the account half of the recovery action it would take. The core never reads any of it, and nothing here is built unless the Ethereum Foundation later picks path A up.

### The base, OpenZeppelin over four candidates

On what base is the example account built? It is an ERC-4337 account with the ERC-7579 executor surface, native multisig support and a factory to deploy it, and if the demo builds it, it proves the kit end to end on a stack the engagement owns.

The same decision moved the Safe action out of scope, and the Safe findings stay below. The recovery action for Ambire's account is the contracts chapter's.

The base is OpenZeppelin's account library pinned at one release. The account is assembled from `Account`, the plain `AccountERC7579` and the `MultiSignerERC7913` signer set, and deploys as immutable clones from its own factory. The release, the entry point and the factory shape are fixed below.

The engagement compared five candidate bases, Safe with its 7579 module, Biconomy's Nexus, ZeroDev's Kernel, OpenZeppelin's account library and the standard's reference implementation. The comparison weighed audits, production usage, multisig model and fit with the executor door, and `design-context/spec-v1/research/account-base-2026-08-31.md` records it. OpenZeppelin won on four grounds.

- It is the only base whose stated job is to be assembled into an account. Every other candidate is a product to adopt.
- Its account code carries the only current audit trail among the workable candidates, two release audits by OpenZeppelin's own team covering v5.4 and v5.6 with no finding above Low against the account code. The pinned release sits outside them, a trade an audit of the assembly would have to read with the pinned base delta, recorded here rather than in the contracts chapter.
- Its native ERC-7913 signer set gives rotation the simplest shape of the field, two self-calls guarded by a threshold check that reverts.
- Because the account is the engagement's own design, it can leave out attack surface every existing base carries: no hook surface, no module registry, no delegatecall through the executor door.

### The coupling, an executor

What may the kit's code do on this account? ERC-7579, still young enough to need introducing, is the standard for plugging outside modules into a smart account, and it names two module powers. A validator can only approve or reject an operation the account presents. An executor acts with the account's own authority. The action on this account is an executor, the shape most of the ecosystem's deployed recovery modules take, and it is the action rather than the manager, the split the idea draft's decision record keeps. It performs the rotation when the manager's conditions are met, and its code can do nothing else.

Two considerations turned out not to decide it.

- Sponsorship is even, since a gas sponsor pays for account operations under either coupling. Whether the account pays whoever submits is named in the request rather than in the setup. An opening request names a payment order, a token, an amount and a payee, inside the digest the helpers sign, so the helpers approve the price beside the outcome, while a self-relayed request names none and a cancel carries no order at all, paid by its submitter. I-18 counts the named payment as part of the committed handover, and its safe payment path is tech-design work.
- Attack surface did not decide it either, though the two are not symmetric. A bug under the executor reaches the account's own authority, where a validator would leave the account to assemble the call, and I-18 limits that larger reach to the committed handover. The executor's code accepts one job and nothing else, executing the exact outcome an approved attempt committed.

What decided it:

- the executor is simpler code, with no validation-phase rules to satisfy
- every 7579 account exposes identical executor plumbing, so one executor action serves all of them
- execution is the anyone-presses-execute sentence of the idea draft, the account being the caller of the inner rotation so the rotated validator needs only ordinary access control
- the two lineages this kit borrows, Candide's module that Safe adopted with formal verification and zkEmail's universal recovery module, are both executors carrying the ecosystem's audit history

The Ethereum Foundation confirmed the executor coupling, which the idea draft's decision record carries in its generic form, the action acting with the account's own authority. An account without the 7579 surface, Ambire's account today, is served by an action built for the door it does have, its own signature-validated execution path, the design the contracts chapter now carries.

### The standard account and its door

ERC-7579 is a standard for smart accounts that accept plug-in contracts called modules. The account keeps a list of installed modules, and each module type has a fixed power. A validator may approve or reject operations the account is asked to run. An executor may ask the account to perform calls with the account's own authority. Installing or removing a module is the account's own decision, and it fires a hook on the module, `onInstall` or `onUninstall`, The module therefore learns of it. The recovery action is an executor.

This chapter uses two more words of the standard. A batch is a list of calls the account performs one after another in its own frame. An execution mode is one word sent along with every execution, saying whether it is a single call or a batch and what happens when a call fails.

The action needs three pieces of that standard surface from the account:

- The install path runs through the standard's two calls: `installModule` with the executor type id installs the action and fires its `onInstall`, and `uninstallModule` fires `onUninstall`. Who may install is the account's own decision, made by its own key through its own execution path.
- The execution call is `executeFromExecutor`, which an installed executor calls to hand the account a batch to perform with the account's authority, and the account opens it to installed executors alone. Every call the kit makes into the account goes through it, made by the action.
- The action and the screens read three views. `supportsExecutionMode` says whether the account runs a given execution mode, and the action asks it once at install for the exact mode it will send, since the standard makes no mode mandatory. `isModuleInstalled` says whether a module is installed and is the authority on that fact. The SDK and the setup screen read it without asking the manager, which hears nothing about installs. `accountId` names the implementation, and the action's `supportsAccount` reads it to tell whether this account is one it serves.

An executor's authority is total: once installed it can ask for any batch at any time, and the standard says so. Two things protect the holder: the action's own code, which only ever builds the one batch an approved payload fixes, and the audit on that code.

### How the batch runs on a 7579 account

The action uses only one execution mode: a batch under the default failure behavior, where a single failing call reverts the whole batch. The action sends its calls, consume, grant, revoke and payment, as one such batch, so an execution either spends the approval, installs the new key, removes the old one and pays the order, or changes nothing at all. In the second case the account is exactly as it was and the attempt is still waiting. The standard also defines a failure behavior where a failing call is only reported and the batch keeps going, and the kit never asks for it.

The standard does not promise that every account runs batches at all. In its words, accounts are not required to implement all execution modes, an account must declare what it supports through `supportsExecutionMode`, and it must revert when asked for a mode it does not support. So the action asks at install: its `onInstall` calls `supportsExecutionMode` with the exact mode it will later send and its own `supportsAccount` on the caller, and refuses to install where either answers no. That costs two static calls per account.

Whether the account honors that refusal depends on its own install path. If the account lets `onInstall`'s revert bubble up, the failed install means the action is never installed on an account that cannot run its batch. Some deployed accounts swallow that revert and record the module anyway, and on those the action can end up installed on an account that will refuse its batch at execution, a risk this record names, since the contracts chapter's account fires no install hook at all.

Installing the action is one call to the account's `installModule` from the holder's own path, the entry point or the account itself, which is how the standard's own reference implementation tests do it. Wrapping that call inside `execute` also works and only matters when the install rides a batch with other calls.

### The account

The account is an assembly of OpenZeppelin's account library pinned at v5.7.0: `Account` for the ERC-4337 base, the plain `AccountERC7579` for the module surface, and `MultiSignerERC7913` for the owner set. The exact combination exists in no OpenZeppelin example, so the assembly is this engagement's own code. It carries its own `accountId` string, which the engagement bumps on every behavior change. If the demo builds it, the audit that covers the kit's other contracts covers the assembly, the factory and the recovery action.

Signature validation works one way on this account. `validateUserOp` and `isValidSignature` always answer from the account's own signer set, and `installModule` accepts the executor type alone and refuses validator and hook module types. No installed module can therefore become a second owner set beside the one the recovery rotates. Day-to-day signing always works, on a fresh account with no module installed and with the recovered key the moment the handover lands.

The owner set lives on the account itself, ERC-7913 signers in an enumerable set with a threshold. A signer is the standard's verifier-and-key bytes, and a 20-byte value reads as a plain address, so an ordinary key and a passkey are both day-to-day signers under the same verifier discipline the kit's methods follow.

The recovery action's handover rotates the address signers, and rotating a passkey signer takes a dedicated action, the scope D-105 states. Rotation is `addSigners` and `removeSigners`, two self-calls with no predecessor bookkeeping. The remove path checks that the remaining set can still reach the threshold, so a batch that would leave the set unable to reach the threshold reverts whole. A new account starts with a single signer and a threshold of one, and the holder raises that threshold when they choose.

Because this account is the engagement's own design, it can leave out attack surface every existing base carries. The plain variant carries no hook surface, so the hook veto the contracts chapter's security notes name cannot arise on it. It consults no module registry, so no outside attester can block a recovery mid-wait. The account also refuses every delegatecall mode on its execution path, `execute` and `executeFromExecutor` alike, and `supportsExecutionMode` declares the same answer. Nobody can therefore run arbitrary code in the account's own frame or swap its implementation.

Everything the account exposes as a function stays reachable as an ordinary call. Refusing those modes costs the kit and the wallet nothing, since neither one sends them. Unknown selectors revert.

The account comes with a factory of immutable minimal-proxy clones, audited beside it, since the base ships none. Each clone carries its implementation address in its own code, so no account upgrades in place and the self-upgrade case the contracts chapter's upgradeability section names cannot arise here. An account-level fix is a new implementation the holder adopts by migration while they still hold their key. The production 7579 accounts all deploy upgradeable ERC-1967 proxies instead, so the immutable clone is a deliberate departure, and it gives an account the immutability the kit's other contracts hold.

The factory follows the standard's rules for its shape. It deploys with CREATE2 over a salt that commits to the initial signer set and a caller-chosen nonce, so the account's address is computable before the account exists, from the factory, the salt and the implementation alone. That makes the address counterfactual, so a holder can receive funds at it and ERC-4337 can deploy it inside its first operation through `initCode`. A deployment frontrun can only produce the account the holder intended, since a different signer set gives a different address. And one credential can still open more than one account, through the nonce.

Deploying and initializing are one act. The clone's initializer runs inside the deploying transaction and runs once, and the implementation locks its own initializer at deployment, so nobody can initialize a counterfactual address under different owners or drive an uninitialized clone. The account refuses a threshold of zero for the same reason.

The factory accepts calls from the entry point's `senderCreator` alone. ERC-4337 routes every account deployment through that contract, and it requires a factory to check for that caller. A repeat call with the same arguments returns the existing address rather than reverting, which keeps the entry point's address prediction working after deployment. The factory holds its implementation in an immutable and reads no storage of its own, so it stays under the storage rules ERC-4337 sets for unstaked infrastructure and never has to lock a deposit with the entry point.

The entry point is pinned at v0.8, the deployed and canonical one, and the pin is permanent for each clone. An old entry point keeps working after it stops being the popular one, since the contract stays deployed and callable directly, and moving to a newer entry point is a migration to a new account. The kit reads no entry point at all.

The base carries three costs. Parts of the module surface ship in files the library marks as drafts, and their semantics have moved between releases, so the engagement pins the release and carries its own `accountId`. The pin itself is a trade. v5.7.0 restores the uninstall semantics the module surface documents and sits outside the library's audits, whose latest covers v5.6 and comes from OpenZeppelin's own team, so an audit of the assembly reads the pinned base delta with it.

The base also documents a delegatecall escape by which an account can force-uninstall a module without firing `onUninstall`. Refusing delegatecall, as above, closes it on this account. The kit leans on no install hook for its own state anyway, since the manager hears nothing about installs, and the action keeps no state a missed hook could leave stale.

The factory is immutable. It has no owner and no path to repoint its implementation, so every clone it ever deploys runs the audited implementation, and a new account implementation means a new factory deployed beside a new action.

### Interface

```solidity
/// The ERC-7579 account surface the kit uses, as the standard defines it.
interface IERC7579Account {
    /// Install a module of the given type. The account calls module.onInstall(initData).
    function installModule(uint256 moduleTypeId, address module, bytes calldata initData) external;

    /// Remove a module of the given type. The account calls module.onUninstall(deInitData).
    function uninstallModule(uint256 moduleTypeId, address module, bytes calldata deInitData) external;

    /// Whether a module of the given type is installed. The authority on installation.
    function isModuleInstalled(uint256 moduleTypeId, address module, bytes calldata additionalContext)
        external view returns (bool installed);

    /// Run executions with the account's authority. Callable by installed executors only.
    /// The action always calls it as a batch under the default failure behavior, checked
    /// at install, so the consume, the key writes and the payment either all land or all revert.
    function executeFromExecutor(bytes32 mode, bytes calldata executionCalldata)
        external payable returns (bytes[] memory returnData);

    /// Run executions with the account's authority, from the account's own validation
    /// path. This is how the holder installs the kit and commits a setup.
    function execute(bytes32 mode, bytes calldata executionCalldata) external payable;

    /// Whether the account can run the given execution mode. No mode is mandatory in
    /// the standard, so the action asks this once at install for the exact mode word
    /// it sends, and refuses to install on a no.
    function supportsExecutionMode(bytes32 encodedMode) external view returns (bool supported);

    /// The implementation's identifier, vendor.name.semver, what supportsAccount reads.
    function accountId() external view returns (string memory id);
}

/// The signer surface of the account, as the pinned release defines it. Every
/// mutation is a self-call: the account is the sole caller, so a rotation is a batch
/// the account runs in its own frame, which is what the recovery action builds.
interface IKitAccount {
    /// Add signers to the set. Reverts on a duplicate or a malformed signer.
    function addSigners(bytes[] calldata signers) external;

    /// Remove signers from the set. Reverts when the remaining set could not reach the
    /// threshold, the guard that makes grant before revoke load-bearing in the batch.
    function removeSigners(bytes[] calldata signers) external;

    /// Raise or lower the threshold. Reverts on zero and when the set cannot reach it.
    function setThreshold(uint64 threshold) external;

    /// The current threshold, and whether a signer is in the set. What the setup screen
    /// reads beside the action's isAuthority.
    function threshold() external view returns (uint64);
    function isSigner(bytes calldata signer) external view returns (bool);

    /// Enumerate the signer set. What a fresh device reads to name the exact authority
    /// a handover removes, since the lost key is the one value its holder cannot
    /// reproduce by hand.
    function getSigners() external view returns (bytes[] memory signers);
}
```

### How a recovery moves through the account

The pseudocode below sketches the account side, the calls the sections above assume.

```solidity
// Setup, from the holder's own key: one UserOperation whose execution installs the
// action and commits the first setup in one batch.
account.execute(BATCH_MODE, encode(
    Execution(address(account), 0,
        abi.encodeCall(IERC7579Account.installModule, (MODULE_TYPE_EXECUTOR, address(action), ""))),
    Execution(address(manager), 0,
        abi.encodeCall(IPolicyManager.commitSetup, (address(action), commitment, nonce, publicMetadata, privateMetadata)))
));

// Recovery, from anyone. The holder is keyless, so the UserOperation's sender is a
// different account, the submitter's own or a sponsor's, and the target is the
// manager. The account under recovery signs nothing here.
submitter.execute(SINGLE_MODE, encode(Execution(
    address(manager), 0, abi.encodeCall(IPolicyManager.startAttempt, (request))
)));

// The door the action uses when it spends the approval.
function executeFromExecutor(bytes32 mode, bytes calldata executionCalldata) external payable returns (bytes[] memory) {
    if (!isModuleInstalled(MODULE_TYPE_EXECUTOR, msg.sender, "")) revert NotAnExecutor(msg.sender);
    Execution[] memory batch = decodeBatch(mode, executionCalldata);
    for (uint256 i = 0; i < batch.length; i++) {
        (bool ok, bytes memory ret) = batch[i].target.call{value: batch[i].value}(batch[i].callData);
        if (!ok) revert ExecutionFailed(i, ret);    // default failure behavior: any failing call reverts the batch
    }
}

// The batch the recovery action builds for this account, run by
// executeFromExecutor with the account as caller: the spend, then the two key
// writes, then the payment.
Execution(address(manager), 0, abi.encodeCall(IPolicyManager.consume, (address(action), attemptId, keccak256(payload))));
Execution(address(account), 0, abi.encodeCall(IKitAccount.addSigners, (asArray(newSigner))));
Execution(address(account), 0, abi.encodeCall(IKitAccount.removeSigners, (asArray(removedSigner))));
Execution(payee, amount, "");                     // the order, when the native asset pays it
```

On this account the two key calls target the account itself, so the account performs its own signer writes under its own authority.

### The recovery action's account half

On this account the recovery action is an installed executor, and the account half of its design is the module surface, the fit check and the arming pair. This action carries no pause, as D-111 of the contracts chapter states for every action, so its early exit reads the manager's attempt alone:

- **The module surface** is the standard's three hooks and nothing else. `onInstall` asks the account's `supportsExecutionMode` for the exact batch mode the action sends and its own `supportsAccount` for the caller, and reverts where either says no, so both fit checks run on chain while the holder still holds their key. `onUninstall` does nothing, since the action keeps no state to clean. `isModuleType` answers true for the executor type alone.
- **The fit check** `supportsAccount` reads `accountId` and answers for this account's builds alone. `accountId` names a bytecode family rather than a build, so the check is a name check. A fork answering the same string passes it, the holder's own adoption risk like any other account they choose.
- **Arming** is two writes the SDK pairs in one batch, `installModule` with the executor type id for the action and `commitSetup` at the manager, and disarming is the mirror pair. The account's `isModuleInstalled` is the authority on the install, which the action's `isAuthorized(account)` mirrors, and `isModuleType` answers true for the executor type id, the named constant `MODULE_TYPE_EXECUTOR` of the standard's reference implementation.
- **The request builder** reads the account's `getSigners` and `isSigner` to check the handover before helpers sign, the removed authority currently a signer, the new one not, the two different.

The module hooks the action adds to `IRecoveryAction` on this account, and the one error the install can raise:

```solidity
// IRecoveryAction as built for this account adds the standard's module hooks.
// onInstall probes the account's batch mode and this action's own supportsAccount
// and refuses a no; onUninstall does nothing, the action keeping no state;
// isModuleType answers the executor type alone.
function onInstall(bytes calldata data) external;
function onUninstall(bytes calldata data) external;
function isModuleType(uint256 moduleTypeId) external view returns (bool);

error UnsupportedExecutionMode(address account); // install on an account that refuses the action's batch mode
```

The one ERC-4337 call in the picture is the account's own, never the kit's, shown so the sdk chapter knows which contract validates a UserOperation carrying a kit call:

```solidity
/// The ERC-4337 account surface. The kit never calls it. Whichever account sends a
/// UserOperation that targets the manager or the action validates it here with its
/// own validator.
interface IAccount {
    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash, uint256 missingAccountFunds)
        external returns (uint256 validationData);
}
```

The action's side in pseudocode, its execute door and its hooks, the way the sections above compose in code:

```solidity
// The recovery action's side: the execute door and the module hooks.

function executeHandover(address account, bytes calldata payload) external {
    ActionState memory st = manager.stateOf(account, address(this));
    if (st.attempt.state != AttemptState.Waiting || block.timestamp < st.attempt.consumableAfter
        || st.attempt.payloadHash != keccak256(payload))
        revert NotConsumable(account, st.attempt.state, st.attempt.consumableAfter, st.attempt.payloadHash);  // an early exit: consume re-checks all of it inside the batch
    Handover memory h = abi.decode(payload, (Handover));
    if (h.newAuthority == address(0) || h.removedAuthority == address(0) || h.newAuthority == h.removedAuthority)
        revert MalformedHandover(payload);             // the same two refusals the chapter's own Handover carries
    if (holdsAnyPrivilege(account, h.newAuthority)) revert ReservedAuthority(h.newAuthority);   // this action's own view, per the contracts chapter

    Execution[] memory batch = new Execution[](st.attempt.order.amount > 0 ? 4 : 3);
    batch[0] = Execution(address(manager), 0, abi.encodeCall(IPolicyManager.consume, (address(this), st.attempt.attemptId, keccak256(payload))));
    batch[1] = Execution(account, 0, abi.encodeCall(IKitAccount.addSigners, (asArray(abi.encodePacked(h.newAuthority)))));     // a 20-byte value is an address signer
    batch[2] = Execution(account, 0, abi.encodeCall(IKitAccount.removeSigners, (asArray(abi.encodePacked(h.removedAuthority)))));
    if (st.attempt.order.amount > 0) batch[3] = paymentOf(st.attempt.order, msg.sender);
    IERC7579Account(account).executeFromExecutor(BATCH_MODE, encode(batch));       // default failure behavior: all or nothing
}

/// The payment as one execution: a value transfer for the native asset, an ERC-20
/// transfer otherwise. The account performs it, so it reverts if the account cannot.
/// An open order, payee zero, pays the executor.
function paymentOf(PaymentOrder memory o, address executor) internal pure returns (Execution memory) {
    address payee = o.payee == address(0) ? executor : o.payee;
    if (o.token == address(0)) return Execution(payee, o.amount, "");
    return Execution(o.token, 0, abi.encodeCall(IERC20.transfer, (payee, o.amount)));
}

function onInstall(bytes calldata) external {
    // the account itself is the caller, per ERC-7579
    if (!IERC7579Account(msg.sender).supportsExecutionMode(BATCH_MODE)) revert UnsupportedExecutionMode(msg.sender);
    if (!supportsAccount(msg.sender)) revert;                                          // this shape's own refusal to declare, since the built action checks the fit off chain
}

function onUninstall(bytes calldata) external {
    // nothing to clean: the action keeps no state, and the account pairs this
    // uninstall with clearSetup at the manager in the same batch, an SDK duty
}
```

## The consent mode of the pause

The Ethereum Foundation asked for two things of the pause, a way to stop the kit after a bug and a way for a holder to keep using it at their own risk afterwards. The pause D-111 of the contracts chapter specifies answers the first, and each identity method carries it while its pause holder lifts it. The second it does not build, and on 2026-09-09 the Foundation accepted the reason and proposed a choice made at setup instead, which the pause oracle section below records. What this record keeps is the shape the design carried while the stop was permanent, since a stop nothing can lift is what makes an explicit consent mode necessary.

That shape was a second state, deprecate, where the manager keeps running only for a request whose helpers signed a consent flag inside the digest, the flag equal to the state so approvals signed before the switch moved never open an attempt after it, and a deprecated spend paying only attempts opened with the flag.

It was withdrawn for the demo for two reasons. The first is that the mode captures a field of the request rather than the holder's own judgment, since the helpers of a recovery sign that field, so for the bug class the mode exists for, one that lets somebody forge their way into a recovery, whoever forges the proofs signs the consent too. The second is that the precedent research of 2026-09-07, at `design-context/spec-v1/research/kill-switch-precedents-2026-09-07.md`, found no audited production contract with a consent mode of any kind, while every on-chain deprecation it located runs the other way, restricting the user to exit paths. The reversible pause the design now takes has precedent everywhere, so the consent mode has no work left to do for the demo, and a later engagement would need it only if the stop became permanent again.

What a later engagement would weigh, from the same research: a freeze state below the halt, borrowed from Aave's vocabulary, where no new attempt opens and attempts already accepted still land, which covers "users may continue" for in-flight recoveries with no consent flag.

The research also names three more shapes.

- A pause bounded in time, borrowed from Optimism and Lido, lifts itself after a stated span.
- A key that pauses, split from a key that lifts, is Compound's and EigenLayer's shape.
- The consent flag itself travels either as a typed field a wallet renders or as a bump of the EIP-712 domain version that silently retires every earlier approval. One defect is worth carrying into any revival. A consent flag compared against one switch and read by another can be moved into a state where nothing spends, so a revived consent mode needs one switch and one flag.

## The pause oracle

The Ethereum Foundation proposed on 2026-09-09 that the pause stop being a property of a method, and that the account name at setup a separate contract deciding whether that method counts as stopped, so a holder picks the verifier and the party who can stop it as two choices. Two holders naming the same verifier could then disagree about whether it is usable. The design does not build it, and this section records why and how it arrives later.

What the shape buys is one verifier and one set of trusted keys shared under several pause authorities. A second shape is cheaper and the design does not offer it either, since the setup already pins a method address at every place and deploying a method needs nobody's permission, so the same verifier code published twice, once with a pause and once without, would let a holder pick their exposure at setup with no new read. What the contract admits is not the same as what a holder can find, and this variant is an extension anyone may build rather than a choice the kit delivers.

What it would take to become a product answer. A stated delivery standing, whether the kit supports the variant, a named third party does, or it stays a possibility. A party who publishes it, a party who verifies its configuration and a party who has accepted to rotate its trusted keys, since holding the admin role is not the same as having agreed to use it. That admin's own transfer and renounce, distinguished from the pause holder the variant will not have. How a client obtains a verified address for the right chain and version. How a rotation is noticed and applied, and who answers when the two copies diverge. And the limit of the promise, that carrying no pause is not the same as verifying forever, since a key admin can install keys under which legitimate credentials stop verifying and a keyless holder cannot replace a method that stopped working.

For the holder it gives the same exposure as the choice the design does offer, the setup flag D-111 specifies, since the manager honours that flag everywhere it reads a stop and a holder who opted out keeps every path open through an incident. What separates the two is operational, one deployment with one set of trusted keys and one admin against two of each, and a choice a holder makes per setup against one they make by picking an address.

Four findings decided it, all verified against the sources on 2026-09-09 and recorded in `design-context/spec-v1/research/pause-oracle-prior-art-2026-09-09.md`.

- No production system lets a user name, at configuration time, the party who may stop a credential verifier that user relies on. The closest deployed shape is Hyperlane's pausable security module, which a receiving application composes beside its verifier.
- Every deployed instance of a chosen veto authority lets the party who chose it choose again with a live key, and reality.eth is the one system that binds the choice at creation with no setter. A recovery holder has neither, since losing the key is the premise, so a wrongly refusing oracle strands the holder with no way to name another.
- Aave deleted the nearest thing to this shape on 2026-08-05, a third party consulted at call time whose false positives blocked borrows and liquidations at the moments they were most needed. A recovery is the same kind of moment.
- A named optional third party tends to stay unnamed. Every sampled veto seat in Symbiotic held the zero address, and the engineers of the account-module registry closest to this shape report that nothing in their stack configures it.

The cost lands from the first day and the benefit waits for an integrator who needs it. An oracle adds a dependency able to block a recovery at every moment the manager reads a stop, a rule for what its silence means, a record of which policy every attempt used, and one more party the setup screen explains.

Nothing has to be reserved for it now, since reserved bytes in an immutable contract create no code able to read them later. The extension that works needs no change to the manager at all. A later immutable method fixes one verifier and one oracle at its own address, verifies through the first and answers the pause read from the second, and the manager records that address among the methods an attempt used, so the spend reaches the oracle by the path it already walks. The price is one address per pair of verifier and policy, and adopting one is a fresh setup commitment, which needs the holder's key. That adapter turns an oracle it cannot reach into a veto, per D-111, and it cannot do the same for its own failure, since a call that never returns vetoes nothing, so the composition narrows the gap rather than closing it.

## The pause anyone can trigger

The Ethereum Foundation proposed on 2026-09-09 that anyone be able to stop a method by sending a transaction the method itself proves impossible, so whoever finds a bug triggers the stop without holding any role. One deployed construction exists and the design does not build it, and this section records both.

The construction is RISC Zero's emergency stop, verified in source on 2026-09-09. It fronts a proof verifier and takes a receipt whose claim digest is all zeros, a value no honest prover reaches unless the hash behind that digest is broken, verifies that receipt and pauses itself permanently. Its permissioned stop sits in the same file, so the team that builds proof systems shipped the evidence stop beside the guardian's stop rather than in place of it. Six of those wrappers stand on Ethereum mainnet.

Four reasons keep it out of this engagement.

- The evidence reaches a break in the proof system and reaches nothing else. A rotated issuer key, a certificate root gone stale and a circuit compiled against the wrong statement are facts about the world, and no evidence a contract can check will see them. Those three are why the identity methods carry a pause at all, so this mechanism adds to that pause and never replaces it.
- The evidence needs a predicate per stack, a statement the relation itself puts out of reach, and neither identity stack publishes one today. A predicate chosen wrongly hands anyone a stop over a method that has no bug.
- Whether every relation admits such a predicate is unsettled, and so is whether the one chosen needs the circuit to reserve an input. Where it does, adopting the mechanism means new circuits and new method deployments rather than a contract change, which is why the question belongs to whoever builds those circuits.
- Publishing the evidence does not guarantee the stop lands before a spend, and evidence that stays valid after a lift lets anyone stop the method again at once.

A later engagement that wants it owes four things, the predicate for each stack, the inputs that predicate fixes, a demonstration that an honest holder cannot produce it, and the failure classes it actually catches.

## Safe action

Safe keeps its owner set in the account's own storage as a linked list, and the rotation is one call, `swapOwner(prevOwner, oldOwner, newOwner)`, atomic and threshold-neutral, with the predecessor computed at execution. The action is either a Safe module that spends the approval in Safe's native key model, or a 7579 executor action over the Safe7579 module that gives a Safe the standard's surface. Three findings from the research bear on whoever builds it:

- The Safe7579 module's audit standing is far below the singleton's, one full audit against a superseded code generation and a short delta review, with the ERC-7484 registry check disabled in unaudited commits and EntryPoint v0.7 hardcoded.
- A Safe7579 account can hold two or three live owner sets at once, since `validateUserOp` falls back to the Safe's native `checkSignatures` when no validator module is selected, so which set a recovery must rotate is a per-configuration question the action must answer at setup.
- Safe 1.5.0 adds a module guard that runs underneath the 7579 surface and can veto every executor call invisibly, a veto the setup screen would have to name.

## Passkey signer handover

The recovery action rotates address signers alone. On the example account a signer may also be a passkey, the ERC-7913 verifier-and-key bytes, and recovering an account whose lost signer is one takes a dedicated action: the same two self-calls, `addSigners` and `removeSigners`, planned over signer bytes rather than addresses, committed as its own action beside the recovery one. It needs no manager change, since the payload is opaque to the core, and it stays unbuilt because a passkey as the account's own signing key is rare in the wallets the kit targets, a scope the owner set when the recovery action narrowed to address authorities.

## Keystore accounts

EIP-8130 moves an account's keys out of the account and into one shared Keystore contract, deployed at the same address on every chain. The Keystore holds, per account, a list of actors. An actor is a key or a contract, with an authenticator that checks its signatures, an expiry and a scope. Adding or revoking an actor takes a signed change batch, and only an actor with the admin scope can sign it. Anyone can relay the batch. The account itself holds no key table and no key-management call, and it defers every authorization to the Keystore.

Recovery is the case where the admin signature is missing, so the kit's action cannot spend an approval on such an account the way it does on Ambire's, since there is no key-management call for the batch to make. The Keystore also offers a policy slot per actor, a manager address beside a commitment, which looks like the kit's manager and is the wrong place for it, because a policy-bearing actor is never admin and so can never change the key list. The EIP names where recovery lives instead. Any contract implementing `authenticate(bytes32 hash, bytes calldata data) returns (bytes32 actorId)` can be registered as the authenticator of an admin actor, and the EIP names wallet-defined recovery methods as the use. The Keystore reads the authenticator with a static call.

So on a keystore account the kit's action takes the shape of an authenticator. The holder registers it once as an admin actor with no expiry, which is that account's form of the authorization. The recovery opens through the manager, waits and can be cancelled as today. At the spend, a relayer submits a change batch that authorizes the new key and revokes the lost one, and the Keystore asks the authenticator whether the batch's hash is approved. The authenticator reads `stateOf(account, this)` and answers with the recovery actor's id when a waiting attempt at or past its wait binds that hash as its payload and no used method vetoes it. The manager changes nothing, since every read the authenticator needs is a view it already has.

Three things differ from the consume the manager runs today. The authenticator runs as a static call, so it cannot mark the attempt spent, and what refuses a second spend is the Keystore's sequence counter, since the hash the attempt binds includes the batch's sequence and the Keystore refuses a second batch with the same one. The attempt therefore stays waiting at the manager after the keys have changed, until the holder, now holding a key, cancels it or clears the setup. And the payload the helpers approve is the batch hash rather than the new key, so the setup screen and the approval helpers show the batch's contents, which the hash alone does not name. All three sit in the authenticator and the clients, and none touches the manager's state machine.

Nothing is built for it. EIP-8130 is a draft with one author, one implementation and one devnet. Its text and its implementation disagree on the scope bit values, and it does not appear in the meta EIP of the next hardfork. Two of its properties bear on a recovery regardless of the design above. Its account lock caps at eighteen hours and freezes authorize and revoke while on, so it stops a recovery rather than pacing it. And its multichain channel carries a change only to the chains where someone relays it, so a revocation the holder signs once still has to be delivered everywhere. EIP-8141, the frame transaction the next hardfork schedules, changes how a transaction is verified and says nothing about keys, keystores or recovery, so the kit's contracts meet it unchanged.

## The retired delivery role

An earlier shape of the core had the manager execute the handover itself, so an account without the executor door needed delivery machinery: a `planDelivery` call on the action, a ticket the manager held in transient storage for the length of its outbound call, and a nonce bound into the ticket against re-entry through the payment leg.

The core has since inverted to approve-and-never-execute, the decision the idea draft records: the manager's one spend call is `consume`, callable by the account alone, and the action builds the account's own batch with the consume as its first call. That one call serves every account shape, so nothing of the delivery machinery survives and every design in this file assumes the consume core.

## Sources

The designs above condense records that stay in the repository: the demo paths in `design-context/spec-v1/research/demo-paths-2026-09-02.md`, the account and door analysis in `design-context/spec-v1/research/kohaku-door-2026-08-28.md`, the build list in `design-context/spec-v1/kohaku-account-build.md`, and the five-example account research in `design-context/spec-v1/research/account-base-2026-08-31.md`, whose Safe pass carries the Safe findings with their citations. The two pause shapes above rest on `design-context/spec-v1/research/pause-oracle-prior-art-2026-09-09.md`, which carries every source and read date behind them, and the Foundation's own words are in `design-context/spec-v1/research/ef-pause-2026-09-09.md`. The keystore account design rests on `design-context/spec-v1/research/eip-8130-8141-2026-09-11.md`, which reads the EIP, its reference implementation and its discussion thread with their dates.
