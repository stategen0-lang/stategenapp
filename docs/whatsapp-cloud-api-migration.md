# Migration plan — Twilio → WhatsApp Cloud API (go direct, skip Twilio)

Status: **planned, not started.** Gated on a verifiable phone number (a Lebanese
SIM) + Meta setup. The code below is a transport-layer swap; all business logic
(intent, handlers, flows, pairing, writes, pipeline, descriptions, reminders)
is reusable unchanged.

## Why
- No BSP markup — pay Meta's rates directly; Cloud API hosting is free.
- **Removes Twilio's 15-second synchronous-reply limit** — Cloud API is async
  (ack the webhook, send the reply as a separate call), so the Grok-latency and
  template-generation timeout workarounds go away.
- Proactive messaging (6am reminders, new-listing alerts) becomes first-class.
- Native buttons / list menus / WhatsApp Flows (can later upgrade the copy-paste
  forms to tap-to-fill).

## What this does NOT change
- The **phone-number/OTP verification requirement is Meta's, not Twilio's** — it
  stays. Still need a verifiable number (Lebanese SIM) not on the consumer app.
- All of `src/lib/whatsapp/*` except the transport files. Intent, quick-intent,
  handlers, flow-handlers, pipeline-handlers, write-handlers, pairing, deals,
  replies, reminders, calendar, ai/* — untouched.

---

## Prerequisites (your side, in Meta — I can't do accounts/tokens)
1. **Verifiable number** (Lebanese SIM), not on consumer WhatsApp.
2. **Meta app** at developers.facebook.com → add the **WhatsApp** product.
3. **WhatsApp Business Account (WABA)** + register the number in **WhatsApp
   Manager**; verify by SMS/voice (code arrives on the SIM handset).
4. **Permanent access token** — create a **System User** in Meta Business
   Settings with `whatsapp_business_messaging` + `whatsapp_business_management`,
   generate a non-expiring token. (The default token expires in 24h — don't use it.)
5. Note four values: **PHONE_NUMBER_ID**, **WABA_ID**, **APP_SECRET**
   (App → Settings → Basic), and a **VERIFY_TOKEN** you invent.
6. Set the webhook in the app: callback `https://stategenapp.vercel.app/api/whatsapp/webhook`,
   your VERIFY_TOKEN, and subscribe to the **messages** field.

## Env vars (Vercel) — replace the Twilio set
Remove: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`,
`TWILIO_SMS_NUMBER`.
Add:
- `WHATSAPP_PHONE_NUMBER_ID` — for the send URL
- `WHATSAPP_ACCESS_TOKEN` — permanent system-user token
- `WHATSAPP_APP_SECRET` — to verify the `X-Hub-Signature-256`
- `WHATSAPP_VERIFY_TOKEN` — for the GET handshake
- `WHATSAPP_DISPLAY_NUMBER` — the bot's E.164 (for the `wa.me` connect link)
- `WHATSAPP_GRAPH_VERSION` — e.g. `v21.0` (optional; default in code)

(There are already `WHATSAPP_API_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` /
`WHATSAPP_WEBHOOK_VERIFY_TOKEN` placeholders in `.env.local` from the original
scaffold — reuse/rename these to the above.)

---

## Code changes, file by file

### NEW: `src/lib/whatsapp/cloud.ts` (the transport, replaces `twilio.ts`)
Pure-ish helpers, unit-tested where possible:
- `verifyMetaSignature(appSecret, signatureHeader, rawBody): boolean` — HMAC-
  SHA256 of the **raw request body**, compare to `X-Hub-Signature-256`
  (`sha256=...`), timing-safe. **Must use the raw body bytes**, not re-serialized
  JSON.
- `parseInbound(payload): { from, text, name, messageId, type } | null` — pull
  the first message out of `entry[].changes[].value.messages[]`, sender from
  `value.contacts[]`. Returns null for status-only callbacks.
- `toCloudAddress(e164): string` — `normalizePhone` then strip the leading `+`
  (Meta wants `96181056376`, no `+`, no `whatsapp:`).
- `async sendText(to, body): Promise<{ok, error?, id?}>` — `POST
  https://graph.facebook.com/<ver>/<PHONE_NUMBER_ID>/messages` with
  `Authorization: Bearer <token>`, JSON `{messaging_product:"whatsapp",
  to, type:"text", text:{preview_url:false, body}}`.
- `async sendTemplate(to, name, lang, components)` — for proactive messages.
- (later) `sendInteractive(...)` for buttons/lists/Flows.

### REWRITE: `src/app/api/whatsapp/webhook/route.ts`
- **GET** = Meta verification handshake: read `hub.mode`, `hub.verify_token`,
  `hub.challenge`; if token matches `WHATSAPP_VERIFY_TOKEN`, return the challenge
  as plain text 200; else 403. (Replaces the "webhook is running" message.)
- **POST**:
  1. Read the **raw body** (`await req.text()`), verify `X-Hub-Signature-256`
     with `WHATSAPP_APP_SECRET`. Reject 403 on mismatch. (Replaces
     `verifySignature` + form parsing.)
  2. `JSON.parse` → `parseInbound`. If null (status callback), 200 and return.
  3. **Dedupe** on `messageId` — Meta delivers at-least-once. Skip if this wa
     message id is already in `whatsapp_logs` (add a `wa_message_id` column, or
     check existing). Prevents double-processing on retries.
  4. **Ack fast, process async**: return `200` immediately and run the existing
     `route(...)` + reply send under Vercel's `waitUntil` (from
     `@vercel/functions`), so Meta gets an instant ack and Grok/template latency
     no longer matters. The handler ends by calling `sendText(from, answer)`
     instead of returning TwiML.
  5. Logging stays (inbound + outbound rows), keyed by the resolved profile.
- The **pairing / STOP / disabled / unregistered** branches stay identical —
  only how the reply is delivered changes (send vs TwiML return).

Note on `waitUntil`: it keeps the function alive after the response so the async
send completes. If `@vercel/functions` isn't desired, the fallback is to `await`
processing then return 200 — acceptable because we send replies out-of-band, but
`waitUntil` is the clean pattern and fully removes timeout pressure.

### EDIT: `src/app/api/whatsapp/send-reminder/route.ts`
- Swap `sendWhatsApp(\`whatsapp:${num}\`, msg)` → `sendText(num, msg)` — but
  reminders are **proactive/outside the 24h window**, so they must be sent as an
  **approved template** (`sendTemplate`), not free text. See Templates below.

### EDIT: `src/lib/whatsapp/phone.ts`
- Keep `normalizePhone` (identity mechanism is unchanged — inbound `from` is
  E.164 without `+`, which `normalizePhone` already resolves).
- `toWhatsAppAddress` (the `whatsapp:` formatter) → retire or repoint; add
  `toCloudAddress` in `cloud.ts` instead.

### EDIT: `src/lib/whatsapp/pairing.ts`
- `connectLink` currently builds `wa.me/<digits>` from the bot number — point it
  at `WHATSAPP_DISPLAY_NUMBER` instead of `TWILIO_WHATSAPP_NUMBER`. (The
  `/api/me/whatsapp` route reads that env for the link.)

### EDIT: `src/app/api/me/whatsapp/route.ts`
- `botNumber()` reads `WHATSAPP_DISPLAY_NUMBER` instead of
  `TWILIO_WHATSAPP_NUMBER`.

### RETIRE: `src/lib/whatsapp/twilio.ts` + `twilio.test.mjs`
- Delete once `cloud.ts` + `cloud.test.mjs` are in and green.

### TESTS
- `cloud.test.mjs` — `verifyMetaSignature` (known body+secret → known sig,
  tamper → false), `parseInbound` (real Meta payload fixture → fields; status
  callback → null), `toCloudAddress` (`+96181056376` → `96181056376`).
- Existing suites stay green (logic unchanged).
- e2e: replace the Twilio-signed POST helper in the scratchpad scripts with a
  **Meta-shaped JSON payload + `X-Hub-Signature-256`** helper; everything else
  (assertions on DB writes / replies) is reusable. Outbound replies now go via
  the Graph API — in e2e, either stub `sendText` or assert against the outbound
  `whatsapp_logs` row rather than a TwiML body.

---

## Templates (proactive messages only)
Free-form works inside the 24h window (agent messaged first) — the whole
interactive assistant needs **no** templates. Only these need approved templates:
1. **daily_reminder** — "Reminder: Call {{1}} today. Last contact: {{2}}.
   Interest: {{3}}. Reply done, snooze 3d, or not interested." (utility)
2. **new_listing_alert** — match-alert nudge (utility/marketing).

Submit in WhatsApp Manager → Message Templates; approval is usually hours. Store
the approved names in code/env and call `sendTemplate`.

---

## Cutover order
1. Merge the Cloud API code behind the new env vars **without deleting Twilio**
   (both can coexist; the webhook path is what flips).
2. Do the Meta setup + verify the number.
3. Set the `WHATSAPP_*` env vars in Vercel, point Meta's webhook at the URL,
   deploy.
4. Complete Meta's GET verification handshake (confirm it subscribes).
5. Smoke test: message the bot from the SIM's WhatsApp → confirm a reply.
6. Submit + await template approval; switch `send-reminder` to `sendTemplate`.
7. Remove Twilio env vars + `twilio.ts` once stable.

## Rollback
- Keep `twilio.ts` and the Twilio env vars until the Cloud path is proven. The
  webhook can branch on which provider is configured, or revert the route file.

## Effort
- `cloud.ts` + webhook rewrite + send-reminder + phone/pairing/me edits + tests:
  a focused build (~1–2 sessions), because business logic is untouched.
- Gating item is **Meta setup + number verification**, not the code.

## Open decisions
- `waitUntil` vs await-then-200 (recommend `waitUntil`).
- Add `wa_message_id` to `whatsapp_logs` for dedupe (recommended).
- Keep Twilio as a fallback branch during cutover, or hard-swap.
