# StreakPrep WhatsApp Templates

Canonical source for the MSG91 → Meta WhatsApp Business templates used by the
StreakPrep website. All sends route through MSG91 (BSP) on WABA number
**918796633320** (+918796633320). Keep this file in sync when template copy or
variable order changes — the code fills variables **positionally** (`body_1`,
`body_2`, `body_3`), so variable order here must match the code call sites.

## Global settings (all templates)

| Setting | Value |
|---|---|
| WABA / integrated number | `918796633320` |
| Language | English (`en`) |
| Header | None |
| Variable Type (MSG91) | **Number** — positional `{{1}}`, `{{2}}` (never "Text"/named; breaks positional mapping) |
| TTL | blank for Utility; 600s for the Authentication/OTP template |
| Category | Authentication (OTP only) · Utility (all others), sub-type **Custom** |

## Status (2026-08-18)

All six created in MSG91 and Enabled. Meta ignores the requested category and
classifies by **content**, so several were re-categorized on approval:

| Template | Requested | Meta assigned | Action taken |
|---|---|---|---|
| `streakprep_otp` | Authentication | Authentication | — |
| `streakprep_receipt` | Utility | Utility | — |
| `streakprep_renewal` | Utility | Utility | held back (see note) |
| `streakprep_payment_failed` | Utility | **Marketing (accepted)** | dry rewrite still landed Marketing; MSG91 edit doesn't trigger Meta re-categorization. Optional appeal in Meta WhatsApp Manager if Utility ever needed. Razorpay's own dunning covers opted-out parents. |
| `streakprep_referral_refund` | Utility | **Marketing (accepted)** | dry rewrite still landed Marketing ("referral reward" is promotional); richer CTA copy restored since it's Marketing anyway |
| `streakprep_trial` | Utility | **Marketing (accepted)** | left as-is; re-engagement is genuinely marketing |

Marketing vs Utility matters: Marketing costs more per message, is subject to
the recipient's marketing opt-out, and counts against marketing limits. Keep
transactional messages (receipt, payment_failed, refund, renewal) on Utility;
trial nudges are legitimately Marketing.

---

## 1. `streakprep_otp` — Authentication

Meta-standardized auth template (options, not free text):
- Code delivery: **Copy code** button
- Security recommendation: ON → "For your security, do not share this code."
- Expiry: 10 minutes

Renders:
```
{{1}} is your verification code. For your security, do not share this code.
This code expires in 10 minutes.
[ Copy code ]
```

| Var | Meaning | Sample |
|---|---|---|
| `{{1}}` | OTP code (also copy-code button value) | `483920` |

- Env: `MSG91_WA_TEMPLATE_NAME=streakprep_otp`
- Code: `website/functions/_lib/otp.js` (`sendViaWhatsApp`)
- Note: copy-code `button_1` component key is MSG91's documented-but-unverified
  auth format — confirm on first live send.

---

## 2. `streakprep_receipt` — Utility

```
Hi {{1}}, your StreakPrep payment of ₹{{2}} was successful. ✅

Your subscription is active and renews on {{3}}. Keep the streak going!

Manage anytime at streakprep.ai/account
```

| Var | Meaning | Sample |
|---|---|---|
| `{{1}}` | student/child name | `Aarav` |
| `{{2}}` | amount in rupees | `199` |
| `{{3}}` | renews-on date | `18 Sep 2026` |

- Env: `MSG91_WA_RECEIPT_TEMPLATE=streakprep_receipt`
- Fires: successful payment — `website/functions/api/webhooks/razorpay.js`

---

## 3. `streakprep_payment_failed` — Utility

```
Hi {{1}}, we were unable to process the payment for your StreakPrep subscription renewal.

To avoid interruption, please update your payment method within {{2}} days. Manage your subscription at streakprep.ai/account
```

| Var | Meaning | Sample |
|---|---|---|
| `{{1}}` | student/child name | `Aarav` |
| `{{2}}` | grace-period days | `3` |

- Env: `MSG91_WA_PAYMENT_FAILED_TEMPLATE=streakprep_payment_failed`
- Fires: payment failure — `website/functions/api/webhooks/razorpay.js`
- Meta first auto-classified this Marketing (the "keep the streak alive" +
  "Renew now" CTA). Copy above is the dry, transactional rewrite to pull it back
  to Utility — a failed-payment alert must reach parents who opted out of
  marketing, so Utility is the correct home.

---

## 4. `streakprep_referral_refund` — Marketing (accepted)

```
Hi {{1}}, thank you for trusting StreakPrep and recommending us to a friend. 🙏

As promised, your referral reward of ₹{{2}} has been refunded to your original payment method — please allow a few days for it to reflect. No action needed.
```

| Var | Meaning | Sample |
|---|---|---|
| `{{1}}` | student/child name | `Aarav` |
| `{{2}}` | refund amount in rupees | `99` |

- Env: `MSG91_WA_REFERRAL_REFUND_TEMPLATE=streakprep_referral_refund`
- Fires: referral refund — `website/functions/api/webhooks/razorpay.js`
- Category: **Marketing (accepted)** — "referral reward" reads promotional to
  Meta's classifier; not worth fighting.
- **Purpose (per `razorpay.js:88` comment):** this is a *transactional
  clarification*, NOT a promo. The parent is charged the full amount, then a
  separate refund lands days later — this message preempts the "why was I
  charged?" support ticket by naming the exact ₹ amount and the few-days
  timing. Do NOT add a "refer more friends" CTA here — that defeats the purpose
  (an earlier CTA version was rejected in review of intent, 2026-08-18).

---

## 5. `streakprep_trial` — Marketing (accepted)

Meta re-categorized this to Marketing and that's fine — trial re-engagement is
genuinely promotional, and the marketing opt-out behavior is correct here (a
parent who muted promotions shouldn't get "subscribe to resume" pings).

One template reused for all four trial states — `{{2}}` is a full phrase, not a
number. Body must read cleanly with any phrase substituted.

```
Hi {{1}}, {{2}}.

Keep your daily quiz streak going — pick up right where you left off.

Continue: streakprep.ai
```

| Var | Meaning | Sample |
|---|---|---|
| `{{1}}` | child name | `Aarav` |
| `{{2}}` | status phrase (one of the four below) | `2 days left in your free trial` |

`{{2}}` values by trial state (`reminders.js`):
- `trial_2days` → "2 days left in your free trial"
- `trial_lastday` → "Last day of your free trial"
- `trial_grace` → "Your trial ended — subscribe to resume"
- `trial_day14` → "Come back anytime — your streak is waiting"

- Env: `MSG91_WA_TRIAL_TEMPLATE=streakprep_trial`
- Fires: daily reminder cron — `website/functions/api/cron/reminders.js`
- Copy kept price-free to avoid Meta flagging Utility as promotional.

---

## 6. `streakprep_renewal` — Utility (HELD BACK — see note)

```
Hi {{1}}, a heads-up: your StreakPrep subscription will auto-renew in 3 days and ₹{{2}} will be charged to your saved payment method.

No action needed to continue. To manage or cancel: streakprep.ai/account
```

| Var | Meaning | Sample |
|---|---|---|
| `{{1}}` | child name | `Aarav` |
| `{{2}}` | amount in rupees | `199` |

- Env: `MSG91_WA_RENEWAL_TEMPLATE=streakprep_renewal`
- Fires: 3-days-before renewal cron — `website/functions/api/cron/reminders.js`
- **DECISION (2026-08-18): leave this env var UNSET.** The RBI e-mandate
  pre-debit notice (≥24h before an auto-charge) is legally required in India but
  is sent automatically by **Razorpay** as part of Subscriptions/e-mandate
  infrastructure — so a merchant-sent WhatsApp copy is redundant and risks
  double-notifying. Verify Razorpay pre-debit notifications are enabled
  post-KYC; only wire this template if Razorpay is not sending them.

---

## Cloudflare Pages secrets

Set from the project root (`npx wrangler pages secret put <NAME>`):

```
MSG91_WA_AUTHKEY                    # MSG91 top-right AuthKey
MSG91_WA_INTEGRATED_NUMBER          # 918796633320
MSG91_WA_TEMPLATE_LANG             # en
MSG91_WA_TEMPLATE_NAME             # streakprep_otp
MSG91_WA_RECEIPT_TEMPLATE          # streakprep_receipt
MSG91_WA_PAYMENT_FAILED_TEMPLATE   # streakprep_payment_failed
MSG91_WA_REFERRAL_REFUND_TEMPLATE  # streakprep_referral_refund
MSG91_WA_TRIAL_TEMPLATE            # streakprep_trial
# MSG91_WA_RENEWAL_TEMPLATE        # streakprep_renewal — held back (Razorpay covers RBI notice)
CRON_SECRET                        # protects the reminders endpoint
# Leave MSG91_API_KEY UNSET so the SMS fallback path never fires (WhatsApp-only).
```

Then `npx wrangler pages deploy`.

Each non-auth send is individually gated on its env var
(`reminders.js:72`, `razorpay.js`), so unset templates are skipped gracefully —
you can ship them one at a time as Meta approvals land.
