# WhatsApp Flows — native add-listing / add-client forms

Two endpoint-less Flow forms. Once published in WhatsApp Manager, the bot sends a
native pop-up form (fields + Submit) instead of the copy-paste text form; the
submission is turned into a listing/client (via confirm-before-write).

## Publish (one-time, in WhatsApp Manager)
1. **business.facebook.com → WhatsApp Manager → Flows → Create flow.**
2. Name it (e.g. "Add listing"), category **Sign up / Lead generation** (any),
   choose **build with the JSON editor** (not the visual builder).
3. Paste the contents of **`add-listing.flow.json`**. Fix any validation the
   editor flags (it validates live), then **Save** and **Publish**.
4. Copy the **Flow ID** shown for that flow.
5. Repeat with **`add-client.flow.json`** → get its Flow ID.

## Wire it up (Vercel env, then redeploy)
- `WHATSAPP_FLOW_LISTING` = the add-listing Flow ID
- `WHATSAPP_FLOW_CLIENT`  = the add-client Flow ID

The code auto-detects these: if set, "add a listing" / "add a client" send the
Flow form; if unset, it falls back to the text form. Nothing else to change.

## How it maps back
- The screen id must stay **`FORM`**.
- Each field `name` matches a flow step key; the Footer's `complete` payload
  carries them plus **`"__flow": "create_property" | "create_client"`**, which
  the webhook (`handleFlowSubmission`) uses to build the right record.
- Don't rename fields or the `__flow` value without updating the code.

## Notes
- These are **static / no-endpoint** flows (data returns on submit) — no separate
  Flow endpoint server needed.
- The Flow JSON `version` is `5.1`; if the editor requires a different version or
  tweaks a component, adjust and it still works as long as the field `name`s and
  the `__flow` payload are unchanged.
