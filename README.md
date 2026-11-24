# DoThatDomain notifications

Cloudflare-hosted routing for the private DoThatDomain.com development Discord. No developer PC or GitHub Actions runner is needed to process events.

## Routes

- `updates`: pushes, pull requests/reviews/merges, issues/comments, branches/tags, releases, deployments.
- `debugging`: typed bugs, completed bug issues, `fix:` commits/merged PRs, failed workflows/checks/deployments.
- `requests`: `[Request]` issues or feature/enhancement/request labels.
- `ideas`: `[Idea]` issues or idea labels.
- `security`: dependency/code-scanning alerts; falls back to debugging when no separate security destination exists.
- School Wristbands `orders` and Viellos `bookings`: Wix automations currently send reference-only notifications directly. The `/event/<project>` adapter accepts the same event types when these sites move to custom code.
- `wix-patches`: centralized daily checks of the official developer feed and general releases, matched against the installed apps/editors. Potential impacts are explicitly unconfirmed until checked on the site.

## Recording Codex decisions on either PC

Private chats cannot be read by this service. When a user confirms a bug, requested feature or future idea, their Codex should create/update one GitHub issue in the matching repository. Use `[Bug]`, `[Request]` or `[Idea]` at the start of its title. Link an existing issue instead of creating duplicates. Do not publish private conversation transcripts, credentials or customer details. Respect the repository's normal assignment/branch workflow. Errors found by external monitoring must be sent through a configured provider webhook or create an issue; this service does not independently inspect every running application.

## Configuration

Set the encrypted Cloudflare secret `PROJECT_CONNECTIONS` to an object keyed by project slug. Every entry has `name`, exact `repository` (`owner/name`), a random `secret` of at least 32 characters, and `webhooks` keyed by the routes above. Split larger configurations across encrypted `PROJECT_CONNECTIONS`, `PROJECT_CONNECTIONS_2` and `PROJECT_CONNECTIONS_3` values; each must remain below Cloudflare's 5 KB limit. The groups merge into one project catalog. Do not commit this configuration. Each Discord URL is channel-specific. Configure GitHub JSON webhooks at `/github/<project>` with this project's matching secret and SSL verification enabled. GitHub account/actor is never used to filter contributions.

`POST /event/<project>` requires `Authorization: Bearer <project secret>`. A normal message has `{type:'bug'|'request'|'idea',title,description,url}`. An order/booking has `{type:'order'|'booking',reference,status,paymentStatus?,dashboardUrl?}`; extra customer fields are discarded. `{type:'test',route:'updates'}` sends a clearly identified connection check.

`GET /health` returns readiness without exposing destinations. No public administrative or replay endpoint exists. Use Cloudflare's authenticated Durable Object storage/observability tools for diagnostics. Review `uncertain` receipts in Discord before attempting manual replay.

## Reliability and workload

GitHub signatures are verified before JSON parsing. Events are limited to 2 MB. Repository names must match their configured project. Receipt IDs include the event type and SHA-256 of the body, deduplicating redeliveries and replays. Durable SQLite records are retained seven days; no raw webhook credentials are stored in receipts. Queues are limited to 1,000 pending events per project. A dispatcher sends at most five messages per alarm with concurrency one, and retries explicit 429/5xx failures at most three times. Ambiguous transport failures stay diagnostic instead of silently risking duplicate messages.

Each actionable accepted event uses one Worker-to-Durable-Object call. Administrative issue assignment, status changes and unrelated labels are ignored before storage. Normal source processing makes zero GitHub API reads and zero AI calls. One Discord request is needed per routed message. An enqueue uses two indexed reads and one receipt insert. A successful message uses two receipt updates; indexed cleanup/queue reads run once per batch. After activity, an idle object can run one daily expiry cleanup until its seven-day receipt retention empties.

Wix uses two base source fetches daily for both projects together, plus posts for relevant changed items. Existing notes are baselined; more than 25 changed items or a feed gap is diagnostic, not a historical notification flood. The platform feed uses ETags and 304 responses. Developer feed IDs repeat, so item identity includes ID, date and title, with content hashes for revisions.

Checks on 24 November 2026: 11 focused Node tests passed, including contributor routing, authentication, redelivery concurrency, retries, uncertain sends, relevance filtering, sharded configuration and large inputs. Normal 1 KB events took 2.28 ms; supported 1.9 MB events took 12.31 ms in the local entry point (one DO request; zero external reads, temporary writes or AI tokens). Ten projects across three groups processed ten events in 6.66 ms. A measured issue-open plus assignment/status/two-label sequence now enqueues once and posts twice, compared with five enqueues and six posts before filtering (80% fewer queue requests, 67% fewer Discord posts for this sequence). These are local measurements, not production timings. Live Express Couriers issue #256 reached requests after correcting an edge-runtime incompatibility: outbound requests use manual redirects. The dispatcher regression requires this option. Further live checks are recorded in SETUP_STATUS.md.

Deploy with the committed `wrangler.jsonc`, which creates the SQLite Durable Object binding and daily schedule. Cloudflare can build/deploy this private repository directly. `npm test` runs focused checks; no application builds are required. Change the encrypted connections to cut over to a replacement source, preserving channels and historical receipts.
