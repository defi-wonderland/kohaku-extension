# Diana, either a passkey or a passport

Diana works at a design agency and holds a small portfolio she bought through an exchange app she still uses. She has a laptop that runs the extension, an iPhone on iCloud that holds her passkey and reads her passport, a biometric passport, no hardware wallet and nobody she would ask to be a guardian. She is comfortable with apps and impatient with jargon.

She holds two credentials the design touches: a synced passkey and a passport zkPassport can prove. For a small portfolio the larger risk is a lockout, so her path lets either credential recover alone. She stands to lose the account if both credentials fail at once, or if she loses her card and forgets the recovery password, and she reads on the review that the party who can change the key her passport method trusts could, on a path where the passport alone recovers, recover the account alone, and that either credential alone can also take it.

## Journey, setup

Diana chooses guide me from the presets (C-01, second release; in the first release she picks the either one works preset on C-01), ticks two inventory items, another device and a passport (C-03c, second release), and the wizard recommends one group of two, either one recovers, with the line that either one alone can recover this account and either one alone can also take it (C-04b, second release; in the first release the preset carries the same line).

She enrolls the passkey and runs its test (C-05a, C-05) and enrolls the passport through zkPassport's own flow on her phone, with progress shown and a retry offered if it fails, running its test, which is the first release's rehearsal for that row, and reading that the proof shows what the document says and not that she is the one holding it, that renewing the passport ends this method, and that a recovery publishes the identifier her document produces (C-05e).

She keeps the 48 hour waiting period (C-06), keeps the default privacy level and sets the recovery password (C-06e). The dry run is offered (C-07k, second release) and the review repeats the identity line beside the passport row and, under verify the details, names the passport method's admin as a party that could change the key it trusts and, since the passport alone satisfies her rule, could recover the account alone, and its pause holder as the one who can stop it (C-07g). The save passes the fit check and she saves (C-07e) and prints the card, keeping it at home (C-08).

## Journey, recovery

Diana's laptop is stolen with her bag, her phone dies the same week and her Apple account is unreachable. Her signing key lived in the extension on that laptop behind an extension password the thief does not hold, so the account has no usable signer left and the synced passkey cannot assert. On a new laptop she takes the fast track (A-00 to A1-03), finds her address from the card at home (D-02b), confirms the account (D-04d), enters the recovery password and sees the group, any one of two (D-06f, D-06b). The gas step asks her to fund her new key and she sends it ether (A1-04).

She completes the passport row through zkPassport on a phone she borrows, the row handing off to the phone and showing progress (D-07e), passes the gas check (D-09), reads the confirmation with the words no payment (D-11), and submits from her new key (D-11b). She waits 48 hours (D-13) and executes from the same key at execution due after the second gas check.

She lands on the done screen, which says her synced passkey still follows her Apple account, states the repair order, secure the Apple account first, add a fresh credential that does not sync to it, then remove the old row, and since she cannot reach that account, points her at removing the row, and offers to edit or replace her recovery path (D-15d; the cleanup screen D-15 ships in the third release).
