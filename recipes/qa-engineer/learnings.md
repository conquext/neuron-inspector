# Learnings

No runs yet. This file updates after 5+ test runs.

## Testing Defaults

Starting assumptions (to be validated):
- Run all automated audits (a11y, security, perf) on every page — they're cheap
- Form fuzzing with XSS payloads catches real bugs more often than long-input tests
- Network mocking (Phase 4) is high-value but time-expensive — run it on critical paths only
- Screenshot every bug at the moment of failure, not after

## Common Patterns

(Will be populated from cross-app testing patterns)
