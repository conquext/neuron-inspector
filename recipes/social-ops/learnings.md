# Learnings

Updated 2026-09-05 after first live test on LinkedIn.

## Platform Selector Status

| Platform | Last verified | Selector health | Notes |
|----------|--------------|-----------------|-------|
| Instagram | Not yet | Unknown | |
| X/Twitter | Not yet | Unknown | |
| Facebook | Not yet | Unknown | |
| TikTok | Not yet | Unknown | |
| LinkedIn | 2026-09-05 | Partial | Read works, send blocked by CSP |

## LinkedIn — Verified 2026-09-05

**Working:**
- `neuron_navigate` to linkedin.com/messaging/ — works
- `neuron_extract_data` with `.msg-conversation-listitem__link` — extracts conversation list
- `neuron_click` with `texts: ["Person Name"]` — opens conversation
- `neuron_type` with `.msg-form__contenteditable` — types into message box
- `neuron_find_elements` — works for DOM inspection

**Broken / Limited:**
- `neuron_evaluate_js` — **blocked by LinkedIn CSP** (`unsafe-eval` not allowed). Cannot dispatch keyboard events via JS.
- `neuron_screenshot` — requires tab to be in foreground. Fails silently in background tabs.
- `neuron_type` with `\n` — inserts literal newline text, does NOT trigger LinkedIn's Enter-to-send handler
- Send mode toggle dropdown — requires foreground tab focus to render; hoverable content has zero dimensions in background
- `neuron_click` with `.msg-form__send-button` — button doesn't exist when LinkedIn is in "Enter to Send" mode

**Conclusion:** LinkedIn messaging is compose-only via automation. The agent can navigate, read messages, open conversations, and type replies — but cannot press Send. The user must press Enter manually. This is a LinkedIn CSP constraint, not a tool limitation.

**Workaround options:**
1. User presses Enter after agent composes (current approach — approval gate)
2. Build a Chrome extension content script injection that bypasses CSP (possible but fragile)
3. Use LinkedIn's API instead of browser automation for sending (requires OAuth)

## Cross-Platform Patterns

- CSP-heavy sites (LinkedIn, possibly Facebook) block `neuron_evaluate_js`. Fall back to `neuron_click` and `neuron_type` for interaction.
- `neuron_screenshot` requires foreground tab. Always check tab focus before screenshotting.
- Text-based element finding (`texts: ["Label"]`) is more reliable than CSS selectors on platforms that obfuscate class names.
