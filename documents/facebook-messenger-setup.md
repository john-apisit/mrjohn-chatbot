# Facebook Messenger Setup Guide

**Project:** Facebook Page Chatbot (NestJS)  
**Updated:** June 2026  
**Meta UI:** Use-case based dashboard (no “Add products” menu)

This guide walks through obtaining every Facebook-related value in `.env.example` and connecting the bot to your Page.

---

## Overview

| Environment variable | Purpose |
|---------------------|---------|
| `FACEBOOK_APP_SECRET` | Verify webhook POST signatures (`X-Hub-Signature-256`) |
| `FACEBOOK_VERIFY_TOKEN` | Secret string you choose; used during webhook registration |
| `FACEBOOK_PAGE_ACCESS_TOKEN` | Send messages via Graph API Send API |
| `ADMIN_PSID` | Your Page-Scoped ID; bot sends admin notifications here |

Copy `.env.example` to `.env` and fill in these values before starting the server.

---

## Prerequisites

1. A [Meta for Developers](https://developers.facebook.com/) account (register as a developer if needed).
2. A **Facebook Page** for your shop (you must be Page admin).
3. A publicly reachable **HTTPS** URL for webhooks (use [ngrok](https://ngrok.com/) for local development).
4. This project running locally or deployed:

```bash
npm install
cp .env.example .env
# Edit .env with the values from this guide
npm run start:dev
```

Default webhook endpoint: `GET/POST /webhook` on port `3000` (or `PORT` in `.env`).

---

## Step 1 — Create a Meta app (use-case flow)

Meta no longer uses **Add products → Messenger**. Apps are created with **use cases** instead.

1. Open [developers.facebook.com/apps/creation](https://developers.facebook.com/apps/creation/).
2. Enter **App name** and **Contact email** → **Next**.
3. On **Use cases**, select:
   - **Engage with customers on Messenger from Meta**
   - (Wording may vary slightly — choose the Messenger / customer messaging option.)
4. On **Business**, connect or create a **Business portfolio** (recommended for Page access).
5. Complete **Requirements** and **Overview** → **Go to dashboard**.

This use case automatically adds Messenger permissions and webhook support. You do **not** need to add Messenger as a separate product.

### If your app already exists without Messenger

Meta does **not** allow removing use cases after app creation. If your dashboard only shows unrelated use cases (e.g. “Other” with no messaging):

1. Create a **new app** and select **Engage with customers on Messenger from Meta** at creation time.
2. Use the new app for this chatbot.

---

## Step 2 — Get `FACEBOOK_APP_SECRET`

Used by `WebhookService` to validate incoming webhook POST payloads (`X-Hub-Signature-256`).

**Do not confuse this with `FACEBOOK_VERIFY_TOKEN`.** They are different values for different steps:

| Variable | Who creates it | Used for |
|----------|----------------|----------|
| `FACEBOOK_VERIFY_TOKEN` | You invent it | GET handshake when registering webhook |
| `FACEBOOK_APP_SECRET` | Meta shows it in the App settings → Basic | POST signature verification on every event |

1. In the app dashboard, go to **App settings** → **Basic** (left sidebar).
2. Find **App Secret** → click **Show** (Meta may ask for your password).
3. Copy the **exact** value Meta displays (typically a 32-character hex string — **not** a `fb_secret_...` placeholder you make up).
4. Set it in `.env` and in **Vercel → Settings → Environment Variables** (Production):

```env
FACEBOOK_APP_SECRET=abc123def456...
```

**Vercel:** paste the secret **without** surrounding quotes. Redeploy after changing env vars.

Keep this secret. Never commit it to git or expose it in client-side code.

---

## Step 3 — Choose `FACEBOOK_VERIFY_TOKEN`

This is **not** issued by Meta — you invent it. It is **not** the App Secret.

1. Pick any long random string, for example:

```env
FACEBOOK_VERIFY_TOKEN=my-shop-webhook-verify-2026
```

2. Use the **exact same string** when configuring the webhook in Step 5.

How it works:

1. You enter the token in Meta’s webhook settings.
2. Meta sends `GET /webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`
3. The server compares `hub.verify_token` to `FACEBOOK_VERIFY_TOKEN` and responds with `hub.challenge`.

---

## Step 4 — Expose your server (local development)

Facebook requires a public **HTTPS** callback URL.

### Using ngrok

1. Start the NestJS server:

```bash
npm run start:dev
```

2. In another terminal, expose port 3000:

```bash
ngrok http 3000
```

3. Copy the **HTTPS** forwarding URL, e.g. `https://abc123.ngrok-free.app`.
4. Your callback URL will be:

```
https://abc123.ngrok-free.app/webhook
```

For production, use your deployed domain instead (e.g. `https://api.yourshop.com/webhook`).

---

## Step 5 — Configure webhooks (Customize use case)

In the new Meta dashboard, webhook settings live under the Messenger **use case**, not under a top-level Messenger product menu.

1. Open your app at [developers.facebook.com/apps](https://developers.facebook.com/apps/).
2. In the left sidebar, click **Use cases**.
3. On the Messenger use case, click **Customize** (or **Customize use case**).
4. Open **Messenger API settings** (or **Webhooks** within that section).
5. Click **Add Callback URL** (or **Edit Callback URL**).
6. Enter:
   - **Callback URL:** `https://your-domain.com/webhook` (ngrok URL + `/webhook` for local dev)
   - **Verify token:** same value as `FACEBOOK_VERIFY_TOKEN` in `.env`
7. Click **Verify and save**.

Your server must be running and reachable when you click verify. On success, the dashboard confirms the callback URL.

### Subscribe to webhook fields

After verification, subscribe to at least:

| Field | Required for |
|-------|----------------|
| `messages` | Incoming text, images, attachments |
| `messaging_postbacks` | Button and quick-reply taps |

Optional (not required for basic chatbot):

- `message_deliveries`
- `message_reads`
- `messaging_reactions`

---

## Step 6 — Get `FACEBOOK_PAGE_ACCESS_TOKEN`

Used by `MessengerService` to send replies via:

```
POST https://graph.facebook.com/v19.0/me/messages
```

Still under **Use cases** → **Customize** → **Messenger API settings**:

1. Find **Generate access tokens** (or **Access tokens**).
2. Click **Add or remove Pages** and select your Facebook Page.
3. Click **Generate** next to your Page.
4. Copy the token into `.env`:

```env
FACEBOOK_PAGE_ACCESS_TOKEN=your_page_access_token_here
```

### Subscribe your Page to the app

In the same section, ensure your Page is **subscribed** to receive webhook events (toggle or **Subscribe** button next to the Page).

Without Page subscription, webhooks verify successfully but no message events arrive.

### Token lifetime

Tokens shown in the dashboard are often short-lived. For production:

- Exchange for a long-lived Page access token via Graph API, or
- Use a **System User** token through Meta Business Manager for better longevity.

For initial development and testing, the dashboard token is sufficient.

---

## Step 7 — Get `ADMIN_PSID`

Your **Page-Scoped ID (PSID)** on this Page. The bot uses it in `MessengerService.notifyAdmin()` to DM you when orders or slip verifications need attention.

PSID is **per Page** — the same Facebook user has different PSIDs on different Pages.

### Method A — From webhook payload (recommended)

1. Complete Steps 5–6 so webhooks and Page subscription work (see checklist below).
2. From your personal Facebook account, open **Messenger** (app or facebook.com/messages) and **send a message to your Page** (e.g. “hi”).
   - A **comment on a Page post** does **not** trigger the `/webhook` POST endpoint.
3. Check logs on the **same server Meta calls** — not your local terminal unless the callback URL points to localhost/ngrok.
   - **Vercel:** Project → **Logs** (or **Deployments** → latest → **Functions**).
   - **Local/ngrok:** the terminal running `npm run start:dev`.
4. You should see a log line like `Webhook POST received object=page entries=1`. The payload contains:

```json
{
  "object": "page",
  "entry": [{
    "messaging": [{
      "sender": { "id": "1234567890123456" },
      "message": { "text": "hi" }
    }]
  }]
}
```

4. Copy `sender.id` into `.env`:

```env
ADMIN_PSID=1234567890123456
```

### Method B — Graph API Explorer

1. Open [Graph API Explorer](https://developers.facebook.com/tools/explorer/).
2. Select your app and paste your Page access token.
3. After messaging the Page, query conversations or inspect webhook data to find your participant ID.

### Important

- You must have messaged the Page at least once so the bot is allowed to message you back (Facebook 24-hour messaging window applies).
- If `ADMIN_PSID` is empty, the bot still runs; admin notifications are skipped with a warning in logs.

---

## Step 8 — Final `.env` checklist

```env
# Facebook
FACEBOOK_APP_SECRET=          # App settings → Basic → App Secret
FACEBOOK_VERIFY_TOKEN=        # You choose; must match Meta webhook config
FACEBOOK_PAGE_ACCESS_TOKEN=   # Use cases → Customize → Generate access tokens
ADMIN_PSID=                   # sender.id when you message the Page

# Server
PORT=3000
```

Restart the server after changing `.env`:

```bash
npm run start:dev
```

---

## Step 9 — Test end-to-end

1. **Webhook verify:** Step 5 should already show a green / saved state in Meta dashboard.
2. **Incoming message:** Send a message to your Page from Facebook or Messenger app.
3. **Bot reply:** Confirm the server receives the webhook and the bot responds.
4. **Admin notify:** Trigger an order or slip event (if implemented) and confirm you receive a `🔔 Admin:` message on Messenger.

---

## Troubleshooting

### “Customize use case” but no Messenger option

Your app was created without the Messenger use case. Create a new app and select **Engage with customers on Messenger from Meta** during setup.

### Webhook verification fails

| Check | Action |
|-------|--------|
| Server not running | Start with `npm run start:dev` |
| Wrong URL | Must be HTTPS, path must be `/webhook` |
| Token mismatch | `FACEBOOK_VERIFY_TOKEN` in `.env` must match Meta exactly |
| ngrok expired | Restart ngrok; update callback URL in Meta dashboard |
| Firewall | Ensure port 3000 is reachable through ngrok |

### GET `/webhook` works but no POST `/webhook` requests

**GET verification and POST events are separate.** A successful verify handshake (Meta GET returns the challenge, e.g. `yyy`) only proves the callback URL and verify token are correct. Meta still will not send message events until the items below are done.

#### Checklist (most common fixes)

1. **Subscribe your Page to the app** (easy to miss)
   - **Use cases** → **Customize** → **Messenger API settings**
   - Under **Webhooks**, after adding the callback URL, find your **Page** in the list
   - Toggle **Subscribe** on for that Page (must show subscribed/active)
   - Callback URL verified ≠ Page subscribed

2. **Subscribe to the `messages` webhook field**
   - Same Webhooks section → **Subscription fields**
   - Ensure **`messages`** is checked (and **`messaging_postbacks`** if using buttons)

3. **Check the right logs**
   - Your callback URL is `https://mrjohn-chatbot.vercel.app/webhook` → POST events appear in **Vercel logs**, not in a local `npm start` terminal
   - In Vercel: set **Environment Variables** (`FACEBOOK_APP_SECRET`, `FACEBOOK_VERIFY_TOKEN`, `FACEBOOK_PAGE_ACCESS_TOKEN`, etc.) for Production — redeploy after adding them

4. **App is in Development mode**
   - Only Facebook accounts with a role on the app (Admin / Developer / Tester) can trigger webhooks in dev
   - **App roles** → add your personal Facebook account as **Administrator** or **Tester**
   - Or switch app to **Live** (requires completed App Review for public users)

5. **Message via Messenger, not a Page comment**
   - Open Messenger → select your **Page** → send “hi”
   - Do not rely on commenting under a Page post

6. **Send a test event from Meta**
   - **Use cases** → **Customize** → **Webhooks** → **Test** (next to the `messages` field)
   - If the test POST appears in Vercel logs but real messages do not, the Page subscription or app role is usually the issue
   - If the test POST also fails, check Vercel env vars (`FACEBOOK_APP_SECRET` must match the app)

#### Quick self-test

```bash
curl.exe -X POST "https://mrjohn-chatbot.vercel.app/webhook" \
  -H "Content-Type: application/json" \
  -d "{\"object\":\"page\"}"
```

Expected response: `401 Invalid signature` — this confirms POST routing works; Facebook sends a valid signature header.

### Webhook verified but no messages received

- Confirm the Page is **subscribed** to the app in Messenger API settings.
- Confirm webhook fields include `messages`.
- Confirm you are messaging the correct Page.
- Confirm Vercel **Production** env vars match your Meta app (wrong `FACEBOOK_APP_SECRET` → signature fails → Meta may show delivery errors).

### `Webhook POST rejected: invalid signature`

This means POST requests reach your server, but HMAC verification failed.

**Most common cause:** `FACEBOOK_APP_SECRET` is wrong — often confused with `FACEBOOK_VERIFY_TOKEN`, or a made-up placeholder instead of the real App Secret from **App settings → Basic**.

| Check | Action |
|-------|--------|
| Wrong secret | Copy **App Secret** from Meta (Step 2), not the verify token |
| Wrong app | Secret must be from the **same Meta app** that owns the webhook |
| Vercel env | Set `FACEBOOK_APP_SECRET` in Vercel Production env, **no quotes**, then **Redeploy** |
| Local vs Vercel | Vercel uses its own env vars — updating local `.env` alone is not enough |

After fixing the secret and redeploying, send a test message again. You should see `Webhook POST received` **without** the invalid signature warning.

Other causes (less common):

- Do not modify the raw request body before signature verification (this project stores `rawBody` in `main.ts` for that reason).

### Send API errors (403 / 200 with error in body)

- Page access token may be expired — regenerate in dashboard.
- User may be outside the 24-hour messaging window.
- App may need **App Review** for production users who are not app admins/testers.

### Cannot find App Secret or webhooks in dashboard

Use the left sidebar:

- **App settings → Basic** for App Secret
- **Use cases → Customize** for webhooks and Page tokens

The old **Add products → Messenger → Settings** path is deprecated in the new UI.

---

## Security reminders

| Item | Guidance |
|------|----------|
| `.env` | Listed in `.gitignore`; never commit secrets |
| App Secret | Backend only; used for HMAC signature verification |
| Page Access Token | Backend only; treat like a password |
| Verify Token | Shared with Meta during setup; keep non-obvious |
| App Review | Required before non-admin users can interact with a live app |

---

## Related project docs

- [technical-spec.md](./technical-spec.md) — architecture, modules, webhook payload examples
- `.env.example` — all environment variables for the full stack
