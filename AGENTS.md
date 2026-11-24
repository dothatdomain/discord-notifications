# Notifications service

Keep integration changes independent of client application code. Never commit/log webhook URLs, project secrets, OAuth credentials, private chats or customer contact details. Preserve signature/repository checks, channel-specific destinations, mention suppression, bounded queues/retries and diagnostic handling of ambiguous delivery.

For confirmed future work, create/update a GitHub issue using `[Bug]`, `[Request]` or `[Idea]` title prefixes. Check for duplicates and record a concise approved summary, not a private chat transcript.

Run focused tests and measure representative/large event entry points before deploying routing or polling changes. Preserve exact event classification, access controls, replay protection and freshness. Keep README workload estimates distinct from production counters. Test parser changes against observed source markup; an empty parse must remain a diagnostic failure.
