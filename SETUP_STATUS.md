# Notification setup status - 24 November 2026

## Verified

- Express Couriers: seven historical summaries covering 14 October to 24 November posted in Discord updates; full archive contains 97 commits. [Archive](history/express-couriers-2026-11-24.md).
- Express Couriers: signed GitHub events reach the hosted router. Issue #256 was visibly delivered to requests under the project-specific bot identity after fixing the Cloudflare redirect incompatibility.
- Viellos and School Wristbands: GitHub hooks saved with 18 selected contributor event types, JSON, SSL verification and matching HMAC secrets; test pings succeeded.
- All ten projects: 44 channel-specific Discord destinations captured, with 44 distinct webhook URLs. Credentials were saved only as encrypted Cloudflare secrets, split into three groups (2685, 2810 and 2137 bytes).
- Cloudflare GitHub Builds completed successfully for the current sharded-configuration source. Daily Wix schedule is 08:17 UTC. No developer PC or GitHub Actions runner is required for normal delivery.
- Wix: School Wristbands order-placed automation and Viellos booking-created/cancelled/changed automations are ACTIVE, with reference/status/dashboard messages and no customer contact fields. Real customer event delivery has not been exercised.
- Nine repositories now contain shared Codex capture instructions and typed issue forms. Express Couriers has the equivalent scoped change in [draft PR #257](https://github.com/dothatdomain/expresscouriers/pull/257).

## Saved or submitted; further verification required

| Repository | Last observed state |
| --- | --- |
| expresscouriers | Live request route verified; verify update/fix/idea coverage with normal future activity. |
| viellos | Signed webhook ping successful; real contributor activity delivery still to inspect. |
| school-wristbands | Signed webhook ping successful; real contributor activity delivery still to inspect. |
| dothatdomain-web | Existing webhook updated; success confirmation observed. Check live delivery with sharded settings. |
| promo-bands | Hook saved; initial ping was not yet successful. Recheck after the latest hosted build and redeliver if necessary. |
| ytmp3 | Existing direct integration was verified earlier; replacement router configuration was submitted. Final save and live routing still need verification. |
| cadence | Discord destinations saved; GitHub webhook not yet connected. |
| 3d-god-game | Discord destinations saved; GitHub webhook not yet connected. |
| wardenfall | Discord destinations saved; GitHub webhook not yet connected. |
| ms-rewards-farmer | Discord destinations saved; GitHub webhook not yet connected. |

## Remaining work

1. Restore browser access, configure the four remaining repository hooks and verify the saved/submitted ones above. New issue-template commits in repositories with an active hook provide real push events to inspect.
2. Verify all project routes. Inspect old uncertain receipts before replay; those created by the unsupported redirect option did not represent confirmed Discord delivery. Do not blindly replay transport-uncertain sends.
3. Verify the first Wix-monitor baseline and its platform HTML parser in the hosted runtime. The scheduled job is configured; its two feed snapshots and both wix-patches channel notices have not yet been verified. Potential impacts remain advisory, not proof that a site is broken.
4. Observe the next real School order and Viellos booking event. Do not create artificial customer orders/bookings merely for testing.
5. Complete the Express Couriers exact-diff review and merge PR #257 using its normal collab:merge helper. No direct main push was used.
6. Import project source into the newly created placeholder repositories when available. Creating the repositories did not upload local application source.

Browser and terminal work stopped because the session's environment permissions contain invalid Windows paths (a Unix permission root caused browser initialization failure; process sandbox setup rejected file:///workspace). Connected GitHub actions remained available. The unrelated Project Pulse checkout was not changed. No further user approval is needed for the already authorized setup; the environment blocker must be resolved.
