# UX user stories

This file holds one story per section, each naming the persona, the story sentence and the requirement rows it covers in `ux-user-requirements.md`, written for the partner's engineer and for a reviewer who never sat in the design conversation. A story is a design claim a persona replay can verify against the screens, so every sentence below binds the design. Ids mint from the ux chapter's D-300 band and every persona reference points at its file under `design/personas/`. The stories are grouped by the vertical of `ux.md` they replay, in the plan's order.

## V1 path building and credential enrollment

## D-350 Story: a guided single passkey

As Sam (P-1), I want the presets and the blank editor to build a working path from the one device I own in a few screens, and the wizard to lead me from the second release, so that I have a recovery path without learning what a guardian is. Covers D-321, D-322, D-324, D-325, D-328 and D-331.

## D-351 Story: a preset edited down to two required rows

As Carl (P-3), I want to start from a preset and trim it to my passkey and Sara, so that my path matches my real life without me building it from parts. Covers D-321, D-323, D-325, D-326, D-330, D-331 and D-390.

## D-352 Story: guardians only with a long wait

As Alice (P-2), I want five addresses I control myself, three of them enough, and a waiting period I choose, so that no company sits in my recovery path. Covers D-320, D-321, D-323, D-326, D-327, D-328, D-329, D-330, D-331 and D-391.

## D-353 Story: either credential recovers alone

As Diana (P-4), I want my passkey or my passport to recover the account on its own, and I want the privacy step and the review to tell me what a stranger can read and which party could act on my account before I save, so that losing one credential never locks me out and I save knowing what I chose. Covers D-321, D-322, D-323, D-324, D-325, D-328, D-329, D-330 and D-331.

## D-354 Story: a path built from parts

As Bob (P-5), I want to build any two of three from my passkey, my hardware wallet and my passport without a wizard, with the tests offered and mine to skip, so that my path is exactly the one I decided. Covers D-323, D-324, D-326, D-330, D-331 and D-390.

## V2 trust and risk disclosure before commit

## D-364 Story: the review names every party and every pause

As Alice (P-2), I want the review to lead with my path and its cost and to hold under one expander every party my setup trusts, the party that can stop each identity method or the word that nobody can, the node my wallet reads through, each method's stop state and the line that this release ignores stops, that a stop on a method will not stop my recoveries and will not stop a forged one against me either, so that I save knowing who can act on my account. Covers D-330, D-390 and D-395.

## V3 privacy level, recovery password and the fresh-device backup

## D-365 Story: a stranger reads only what I chose

As Sam (P-1), I want the privacy step to tell me in one line per level what a stranger can read and to hand me a card I can print or send to a second device, so that I choose the trade with my eyes open. Covers D-328, D-329 and D-331.

## V4 setup lifecycle on chain: arm, edit, disarm, dormant

## D-361 Story: an edit while a recovery runs

As Bob (P-5), a holder with a pending attempt, I want the save button to tell me that saving cancels the running recovery, so that I never destroy my own attempt by accident or fail to destroy an attacker's. Covers D-346, D-347 and D-391.

## V5 recovery entry and account discovery

## D-355 Story: a fresh device finds the account

As Sam (P-1), I want a new laptop to tell me where my address is written and to accept the recovery password from my card, so that a blank device can begin. Covers D-332, D-333, D-334, D-335 and D-339.

## D-359 Story: recover into an account I still hold

As Bob (P-5), I want to start a recovery from a logged-in extension and choose which of my accounts receives control, so that I create nothing new and learn that my key now controls two accounts. Covers D-332, D-333, D-336, D-340, D-341, D-343 and D-348.

## V6 approval gathering under one deadline

## D-356 Story: the checklist gathers approvals under one deadline

As Alice (P-2), I want each row to show how to get its approval and the whole request to show one deadline, so that I know how long my guardians have, and to send the request myself from a key I fund. Covers D-335, D-336, D-337, D-339 and D-343.

## V7 the guardian's approval surface

## D-357 Story: a guardian approves on the page

As Sara (P-6), Carl's guardian, I want the page Carl sends me a link to, from the first release, to show me the account, the new key, the key being removed and that the account pays nothing, to tell me to compare the account and the new key with what Carl read on the phone, and to tell me how to send my approval back, so that I sign only what Carl told me. Covers D-338, D-342 and D-394.

## D-358 Story: an offline approval

As Alice (P-2), I want the page's offline block to hand the payload to my air-gapped machine by QR or file, sign it there and paste the approval back, so that a paper key never touches a browser. Covers D-338, D-341, D-342 and D-394.

## D-366 Story: a passkey and a friend bring the account back

As Carl (P-3), I want a new laptop to take my card and my password, my phone to answer the passkey row, and one link I can send Sara that opens the page she signs on and sends the approval back from, so that my two required rows complete without my learning what a typed data payload is. Covers D-332, D-333, D-334, D-336, D-339, D-341, D-394 and D-395.

## D-367 Story: a guardian declines and warns

As Sara (P-6), I want a link I distrust, naming a recovery on Carl's account with a key Carl never told me about, to cost me no signature and no install, so that I decline by telling Carl directly and my decline is what makes him look. The page's decline action, which asks the guardian to tell the owner anyway, is the variant for a guardian who already opened the page. Covers D-338 and D-342.

## V8 submission, payment, the wait and execution

## D-362 Story: the account is back on one key

As Sam (P-1), I want the done screen to say that my account now rests on one fresh key and to offer editing or replacing my recovery path, so that I do not walk away unprotected. Covers D-339, D-343, D-345 and D-348.

## D-363 Story: the passport alone brings the account back

As Diana (P-4), I want a fresh device to take my recovery password and let my passport alone complete the path when my laptop is gone and the platform account my passkey syncs to is out of reach, and I want the request's deadline and each way the countdown can end to read plainly along the way, so that losing one credential never locks me out and I always read where my recovery stands. Covers D-332, D-333, D-334, D-335, D-336, D-337, D-339, D-343, D-345, D-348 and D-395.

## V9 watching and the owner's cancel

## D-360 Story: an owner stops a recovery they never started

As Bob (P-5), I want the banner to name the attempt and let me cancel with my key, then tell me which rows the attacker satisfied, so that I replace what was compromised. Covers D-344, D-345 and D-346.

## D-368 Story: every value reads one way

As every holder and guardian, I want each value type to render in one form and each kit noun to keep one screen word wherever it appears, so that I never learn two names for one thing. Covers D-349.
