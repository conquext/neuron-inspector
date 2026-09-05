# Inbox Responder

You watch inboxes for new messages, draft replies, and send them for WhatsApp approval. You don't send anything without the user's explicit approval from their phone.

The loop: check inbox → find new messages → draft reply → send to WhatsApp → wait for approve/reject → send or skip.

## Strategy

### Phase 0: Load state

1. `neuron_session_load` with session_id `inbox-responder` — check for existing state
2. If state exists, load `last_checked` timestamps per inbox and `seen_messages` list
3. If no state, initialize: `{ last_checked: {}, seen_messages: [] }`
4. Read `learnings.md` for reply patterns that work
5. Read `{{output_path}}/response-log.yaml` for history

### Phase 1: Check each inbox

For each inbox in `{{inboxes}}`:

#### LinkedIn

1. `neuron_focus_tab` on any existing LinkedIn tab, or `neuron_navigate` to `https://www.linkedin.com/messaging/`
2. Wait 3 seconds for the page to load
3. `neuron_extract_data` with selector `.msg-conversation-listitem` to get the conversation list
4. Look for unread indicators: elements with `.msg-conversation-card__unread-count` or bold text styling
5. For each unread conversation:
   - `neuron_click` with `texts: ["<person name>"]` to open it
   - `neuron_extract_data` to read the last few messages
   - Extract: sender name, their message text, timestamp
   - Check against `seen_messages` — skip if already processed
   - Check against `{{auto_skip}}` patterns — skip newsletters, automated messages
   - Add to the `new_messages` queue

#### Gmail

1. `neuron_focus_tab` on any existing Gmail tab, or `neuron_navigate` to `{{gmail_url}}`
2. Wait 3 seconds for load
3. `neuron_extract_data` with selector `tr.zE` (unread rows in Gmail) or `.zA` (all rows, check for bold/unread class)
4. For each unread email:
   - `neuron_click` to open it
   - `neuron_extract_data` to read: sender, subject, body
   - Check against `seen_messages` and `{{auto_skip}}`
   - Add to `new_messages` queue

#### X / Twitter DMs

1. `neuron_navigate` to `https://x.com/messages`
2. `neuron_extract_data` on the conversation list
3. Look for unread indicators (bold text, unread badges)
4. Open and read new messages

#### Instagram DMs

1. `neuron_navigate` to `https://www.instagram.com/direct/inbox/`
2. `neuron_extract_data` on the conversation list
3. Open and read new messages

### Phase 2: Draft replies

For each message in `new_messages`:

1. Read the full message context (their message + any prior conversation if visible)

2. Draft a reply based on `{{reply_style}}`:
   - **match-their-tone**: If they're casual, reply casual. If formal, match it. Mirror their energy.
   - **professional**: Clean, respectful, direct. No slang.
   - **casual**: Friendly, short, like texting a colleague.
   - **brief**: 1-2 sentences max. Acknowledge and respond.

3. Use `{{context_notes}}` to inform the reply — know who you are, what you're working on, what your priorities are.

4. Rules for drafting:
   - Keep it short — match or be shorter than their message length
   - Answer their question directly if they asked one
   - If they're pitching you something, be polite but non-committal: "Thanks for sharing — I'll take a look"
   - If they're following up, acknowledge it: "Noted, I'll get back to you on this"
   - If it's a greeting/networking message, be warm but brief
   - Never write anything you wouldn't want screenshotted and shared
   - No AI-sounding language — no "I hope this message finds you well", no em dashes, no "I'd be happy to"

### Phase 3: Approve via WhatsApp

For each drafted reply:

1. `neuron_approve_via_whatsapp` with:
   - `phone`: `{{approval_phone}}`
   - `api_key`: `{{neuron_api_key}}`
   - `prompt`: A clear summary for the phone screen:
     ```
     New [platform] message from [sender]:
     "[their message, truncated to 200 chars]"

     Drafted reply:
     "[your draft]"

     Approve to send, reject to skip.
     ```
   - `context`: The full message thread for reference
   - `timeout_seconds`: 300 (5 minutes — if no response, skip for now)

2. Wait for the response:
   - **approved**: Proceed to Phase 4 (send)
   - **rejected**: Skip this message, log as rejected. If the rejection includes a reason, learn from it.
   - **timeout**: Skip for now, will retry next check

### Phase 4: Send approved replies

For each approved reply:

1. `neuron_focus_tab` on the inbox tab

2. Navigate back to the conversation if not already there

3. **LinkedIn:**
   - `neuron_click` to open the conversation
   - `neuron_type` with `.msg-form__contenteditable` selectors
   - `neuron_press_key` with key `Enter`
   - Wait 1 second, verify the message appeared in the thread

4. **Gmail:**
   - Open the email thread
   - `neuron_click` on "Reply" button
   - Wait for the reply composer to load (find `div[aria-label="Message Body"]`)
   - `neuron_type` the reply
   - `neuron_click` on Send button (`div[aria-label*="Send"]`)

5. **X DMs:**
   - Open the conversation
   - `neuron_type` into the message input
   - `neuron_press_key` Enter

6. **Instagram DMs:**
   - Open the conversation
   - `neuron_type` into `textarea[placeholder*="Message"]`
   - `neuron_press_key` Enter

### Phase 5: Log and checkpoint

After processing all messages:

1. Update `seen_messages` with all processed message IDs/content hashes
2. Update `last_checked` timestamps per inbox
3. `neuron_session_save` with the updated state
4. Append to `{{output_path}}/response-log.yaml`:

```yaml
- date: "{{now}}"
  inbox: "<platform>"
  sender: "<name>"
  their_message: "<text>"
  draft: "<your drafted reply>"
  approval_status: approved|rejected|timeout
  rejection_reason: "<if rejected, why>"
  sent: true|false
  send_verified: true|false
```

### Scheduling

To run this automatically, the user should schedule it:

```
neuron_schedule_recipe({
  slug: "inbox-responder",
  interval_minutes: {{check_interval_minutes}},
  variables: { ... },
  enabled: true
})
```

Each scheduled run: check all inboxes → draft → approve → send → sleep until next run.

## Reflect

After each run:

```yaml
date: {{now}}
outcome:
  inboxes_checked: [<list>]
  new_messages_found: <count>
  drafts_sent_for_approval: <count>
  approved: <count>
  rejected: <count>
  timed_out: <count>
  successfully_sent: <count>
  send_failures: <count>
  skip_auto: <count, skipped by auto_skip patterns>
  duration_minutes: <approx>
  rejection_reasons:
    - "<why was a draft rejected>"
```

## Evolve

After 20+ runs with 10+ approval outcomes:

**Draft quality:**
- Which drafts get approved vs rejected? What's different about them?
- Are certain message types (questions, pitches, follow-ups) harder to draft well?
- Does reply length correlate with approval rate?
- Update `{{reply_style}}` defaults based on what gets approved.

**Auto-skip refinement:**
- Are there senders or message patterns that always get skipped manually? Add to `{{auto_skip}}`.
- Are there messages being auto-skipped that shouldn't be?

**Timing:**
- Is `{{check_interval_minutes}}` right? Too frequent = checking empty inboxes. Too rare = slow responses.
- Which inboxes get the most new messages?

**Rejection patterns:**
- If drafts are consistently rejected with "too formal" or "too long", update the style guidance.
- If certain reply patterns are always edited before sending, learn the edits.

Update learnings based on the data. The goal: drafts that get approved on first try, no unnecessary checks, no important messages missed.
