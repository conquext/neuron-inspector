# Learnings

Updated 2026-09-05 from first live execution failures.

## Platform Research Defaults

Starting assumptions (to be validated by actual research each session):

**LinkedIn (as of mid-2026, verify before relying):**
- Free accounts: ~100 connection requests/week, ~150 DMs/day to connections
- New accounts have lower limits for the first 2-4 weeks
- Sales Navigator raises limits significantly
- Identical messages to 5+ people in a short window triggers review
- Profile view spikes trigger alerts

**X/Twitter:**
- DM limits vary by verification status
- New accounts are heavily restricted for the first 30 days
- Aggressive following/unfollowing is the fastest way to get suspended

**Instagram:**
- DM limits are tied to account age and follower count
- New accounts: ~20-30 DMs/day
- Mature accounts: ~50-80 DMs/day
- Action blocks last 24-48 hours

These are starting points. ALWAYS research current limits during Phase 2.

## Execution Failures — Confirmed (2026-09-05 live testing)

These are real failures that occurred during the first live test. Every plan MUST account for them.

### Background tab interaction (CRITICAL)
**What happened:** Agent clicked Send on LinkedIn and Gmail. Both reported success. Neither actually sent — buttons and dropdowns render at zero dimensions in background tabs.
**Fix:** EVERY plan step that clicks, types, or submits MUST include `neuron_focus_tab` first. No exceptions.

### Framework change detection (CRITICAL)
**What happened:** Agent typed a message into LinkedIn's compose box. The text appeared visually, but LinkedIn's Ember.js framework didn't detect it — the Send button stayed disabled.
**Why:** Direct DOM property assignment (`el.value = x`, `el.textContent = x`) is invisible to React/Ember/Angular/Vue. These frameworks use their own state management and only detect input from native browser events.
**Fix:** `neuron_type` now uses `document.execCommand("insertText")` for contenteditable and native prototype setters for inputs. Plans should NOT rely on `neuron_evaluate_js` for typing.

### CSP blocking eval (HIGH)
**What happened:** Agent tried to dispatch keyboard events via `neuron_evaluate_js` on LinkedIn. CSP blocked it: `unsafe-eval` not allowed.
**Which platforms block eval:** LinkedIn (confirmed). Facebook, Instagram likely.
**Fix:** Never plan steps that use `neuron_evaluate_js` for interaction on social platforms. Use `neuron_click`, `neuron_type`, `neuron_press_key` instead.

### Scroll direction for messages (HIGH)
**What happened:** Agent extracted messages from a LinkedIn conversation. It read the first messages in the DOM — which were OLD messages from the top. The most recent message (the one to reply to) was at the bottom, off-screen.
**Why:** All messaging apps (LinkedIn, Gmail threads, X DMs, IG DMs, TikTok DMs) show newest messages at the bottom. The agent must scroll to the bottom before extracting.
**Fix:** Every plan step that reads messages MUST include "scroll to bottom of conversation" before extracting.

### Send verification (MEDIUM)
**What happened:** Agent claimed "message sent" without verifying. The message was actually still in the compose box.
**Fix:** After every send action, plan a verification step: wait 1-2 seconds, then extract the conversation and confirm the new message appears. If it doesn't, the send failed.

### Lazy-loading content (MEDIUM)
**What happened:** Gmail's reply composer didn't exist when the agent tried to type into it. The composer loads asynchronously after clicking Reply.
**Fix:** After any action that triggers new UI (clicking Reply, Compose, opening a modal), plan a wait + `neuron_find_elements` to confirm the target element exists before interacting with it. Don't assume it's there immediately.

### Chrome sideload path confusion (LOW)
**What happened:** Chrome was loading an old extension build from a stale directory. The TOOL_CALL handler didn't exist in the old build.
**Fix:** Verify the extension version before starting any plan. `neuron_diagnose` returns the extension status.

## Pre-mortem Checklist

Every plan should be checked against this list before finalizing:

- [ ] Every click/type/submit step has `neuron_focus_tab` before it
- [ ] Every message-reading step scrolls to bottom first
- [ ] No `neuron_evaluate_js` for interaction on CSP-heavy platforms (LinkedIn, Facebook, Instagram)
- [ ] Every send/submit step has a verification step after it
- [ ] Every step that triggers new UI has a wait + find before interacting with the new UI
- [ ] Login/auth state is checked before starting (neuron_detect_blocker)
- [ ] There's a plan for what happens if a captcha appears (answer: stop everything)
- [ ] Selectors have text-based fallbacks for platform DOM changes
