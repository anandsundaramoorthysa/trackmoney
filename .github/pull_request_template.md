# What was wrong

<!--
The situation before this change, not a restatement of the diff. If it fixes an
issue, link it: "Fixes #12".
-->

# What this does about it

<!--
And, where it is not obvious, why this way rather than another. If you removed
a guard, say what answered the reason it was there.
-->

# How you know it works

<!--
The standard in this repository is that a test which cannot fail is worse than
no test. For a change in behaviour: revert your fix, watch the test go red, put
it back. Say that you did.

For anything visual, the width you checked at is more useful than a device name.
-->

- [ ] `npm run typecheck` and `npm run lint` are clean
- [ ] `npm run test:facts` passes
- [ ] `npm run test:integration` passes, or does not apply
- [ ] `npm run test:e2e` passes, or does not apply
- [ ] Behaviour change is covered by a test that fails without the change
- [ ] No secret, token or real financial data anywhere in the diff

# Anything you are unsure about

<!--
Genuinely useful. A pull request that says "I think this is right but I could
not work out how it interacts with X" is easier to review than one that is
quietly confident.
-->
