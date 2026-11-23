# Creator / Influencer automation (Make → Shopify → email)

When someone submits the **Creator / Influencer Partners** form at
`community.themajorities.com/partner`, the backend (`POST /api/duma/partner`):

1. saves the application as it always has,
2. reserves a personal follower discount code for the account (`Sarah Smith` → `SARAHSMITH5`;
   if that code is already taken it becomes `SARAHSMITH5B`, `SARAHSMITH5C`, …),
3. POSTs the application as JSON to your Make webhook. Make then creates the 5% discount in
   Shopify and emails the code to the creator.

Each account gets **one** code. Applying again doesn't create a second Shopify discount.
If Make is down or rejects the request, the moderation inbox (`MODERATION_EMAILS`) gets an email
with the reserved code. You can retry with `POST /api/admin/creators/discount-resend { "email": "…" }`
(admin token required).

The backend also sends the normal "Welcome to The Majorities Creator Program" email. While the
automation is on, that email says the discount code is coming in a separate email.

## Backend environment variables (Render)

| Variable | Required | Value |
|---|---|---|
| `MAKE_INFLUENCER_WEBHOOK_URL` | yes | The Make Custom Webhook URL (`https://hook.us1.make.com/...`). Leave unset to turn the automation off. |
| `MAKE_INFLUENCER_WEBHOOK_SECRET` | recommended | Any long random string. Sent as the `X-Majorities-Secret` header. |
| `INFLUENCER_DISCOUNT_PERCENT` | no | Defaults to `5`. Changes the code suffix and the value in the payload. |

## Webhook payload

The backend sends this JSON. Every key is top-level, so it maps straight onto fields in Make:

```json
{
  "event": "influencer_partner_application",
  "submittedAt": "2026-11-23T18:04:11.000Z",
  "applicationId": "674212…",
  "category": "Creator / Influencer Partners",
  "fullName": "Sarah Smith",
  "firstName": "Sarah",
  "businessEmail": "sarah@sarahsmithmedia.com",
  "accountEmail": "sarah@gmail.com",
  "discountCode": "SARAHSMITH5",
  "discountPercent": 5,
  "shopifyValue": "-5.0",
  "priceRuleTitle": "Sarah Smith Referral",
  "socialHandles": "Instagram: https://instagram.com/sarah (12k followers)",
  "socialAccounts": [{ "platform": "Instagram", "url": "https://instagram.com/sarah", "followers": "12k" }],
  "primarySocialUrl": "https://instagram.com/sarah",
  "city": "Atlanta", "state": "GA", "country": "United States",
  "contentPitch": "…", "doneBefore": "Yes", "experienceDetails": "…",
  "mediaUrls": ["https://…"]
}
```

`discountCode` is already uppercase with no spaces, so Make doesn't need `upper()` or `replace()`.

## Make scenario

### Phase 1: Trigger (Webhooks → Custom webhook)
1. Create a new scenario and add **Webhooks → Custom webhook**.
2. Click **Add**, name it `Influencer Partnership Form`, and save. Copy the URL.
3. Set `MAKE_INFLUENCER_WEBHOOK_URL` (and `MAKE_INFLUENCER_WEBHOOK_SECRET`) on the Render backend and redeploy.
   You don't need to change the form. The backend forwards the submission.
4. In the webhook's advanced settings, turn on **Get request headers** so you can check the secret.
5. Click **Run once**, then submit a test Creator / Influencer application on the site. Make learns the fields from that submission.
6. Add a **filter** after the webhook: `headers[x-majorities-secret]` *Equal to* your secret, **and**
   `event` *Equal to* `influencer_partner_application`.

### Phase 2: 5% price rule (Shopify)
Connect the Shopify module to the `c0bqfe-z2` store. The connection needs the `write_price_rules`
and `write_discounts` scopes.

* **Title:** `{{priceRuleTitle}}`
* **Value type:** Percentage
* **Value:** `{{shopifyValue}}` (or type `-5.0`)
* **Customer selection:** All
* **Target type:** Line item
* **Target selection:** All
* **Allocation method:** Across
* **Starts at:** `{{now}}`
* **Once per customer:** optional, and recommended

### Phase 3: Discount code (Shopify → Create a Discount Code)
* **Price Rule ID:** the `ID` output from Phase 2
* **Code:** `{{discountCode}}`

> **If your Shopify module has no "Create a Price Rule" action:** Shopify has moved price rules into
> its GraphQL discounts API. Use one **Shopify → Make an API Call** module (GraphQL) in place of
> Phases 2 and 3:
>
> ```graphql
> mutation {
>   discountCodeBasicCreate(basicCodeDiscount: {
>     title: "{{priceRuleTitle}}"
>     code: "{{discountCode}}"
>     startsAt: "{{now}}"
>     customerSelection: { all: true }
>     customerGets: { value: { percentage: 0.05 }, items: { all: true } }
>     appliesOncePerCustomer: true
>   }) {
>     codeDiscountNode { id }
>     userErrors { field message }
>   }
> }
> ```
> Add a filter after it: continue only when `userErrors` is empty.

### Phase 4: Email the code (Gmail / Email → Send an email)
* **To:** `{{businessEmail}}`
* **Subject:** `Welcome to The Duma! Your Partner Code is inside`
* **Content (HTML):**

```html
<p>Hi {{firstName}},</p>
<p>Welcome to The Duma partner program! Your personal follower discount code is:</p>
<p style="font-size:22px;font-weight:bold;letter-spacing:2px;">{{discountCode}}</p>
<p>Share it with your followers. They get {{discountPercent}}% off at
<a href="https://themajorities.com">themajorities.com</a>, and you earn your referral commission on every order that uses it.</p>
<p>Questions? Just reply to this email.</p>
<p>Welcome aboard,<br>The Majorities Team</p>
```

Use the `discountCode` field from the **webhook** (Phase 1), not the Shopify output. Then the
email still has the right code if you later switch Phases 2 and 3 to the GraphQL call.

### Error handling (recommended)
Right-click the Shopify module → **Add error handler → Break** (it retries automatically), or send
yourself a Slack or email alert. The backend has already saved the code on the user. To re-run a
failed submission, call the resend endpoint above.
