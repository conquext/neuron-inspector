# Learnings

Updated 2026-09-05 after first live LinkedIn test.

## CRITICAL: LinkedIn Send Limitation

**The agent cannot press Send on LinkedIn.** LinkedIn's CSP blocks `unsafe-eval`, so keyboard event dispatch via `neuron_evaluate_js` fails. The `\n` character inserts literal text instead of triggering Enter-to-send. The send button doesn't exist in "Enter to Send" mode.

**What works:** Navigate to messaging, open conversations, read messages, type replies into the compose box.

**What doesn't:** Pressing Send. The message sits in the compose box waiting for the user to press Enter.

**Approved workflow:** The agent composes the message, screenshots it for review, then tells the user to press Enter. This is actually better for the approval gate — the user sees the exact message before it sends.

**Verified selectors:**
- `.msg-conversation-listitem__link` — conversation list items
- `.msg-form__contenteditable` — message compose box
- `texts: ["Person Name"]` — clicking to open a specific conversation
- `button.msg-form__send-toggle` — send mode toggle (but dropdown needs foreground)

## Message Defaults

Starting assumptions from cold outreach best practices (to be validated):

**What tends to work on LinkedIn:**
- Reference a specific post they wrote (highest signal that you actually looked at their profile)
- Keep under 300 characters for the opening paragraph
- Ask a question rather than making a statement
- One clear, low-commitment ask
- No "hope you don't mind the cold message" — gets to the point with confidence

**What kills response rates:**
- "I was impressed by your expertise" / "I came across your profile" (LinkedIn spam fingerprint)
- Feature lists or pricing in the first message
- "Let's hop on a call" as the first ask (too high commitment)
- Identical messages to multiple people (LinkedIn detects this)
- Sending during off-hours for the recipient's timezone

**Hook effectiveness (to be validated by data):**
1. Referencing their post → highest expected response rate
2. Shared connection mention → second highest
3. Company-specific problem → third
4. Role-based relevance → baseline
5. Generic "your background" → lowest, avoid

## Anti-Patterns Registry

Messages that should never be sent (will be expanded from negative response data):
- Anything that reads like a template
- Anything that could apply to anyone without modification
- Anything longer than 5 short paragraphs
- Anything with emoji in the opening line
- Anything that starts with "Hi [Name]," followed by a pitch
