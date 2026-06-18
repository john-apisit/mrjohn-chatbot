# Supabase Setup & Migration Guide

**Project:** Facebook Page Chatbot (NestJS)  
**Updated:** June 2026  
**Database:** PostgreSQL via Supabase  
**Storage:** Private `slips` bucket for payment slip images

This guide walks through creating a Supabase project, applying the schema migrations in `supabase/migrations/`, configuring Storage, and filling in the Supabase values in `.env`.

---

## Overview

| Environment variable | Purpose |
|---------------------|---------|
| `SUPABASE_URL` | Project API URL (e.g. `https://xxxx.supabase.co`) |
| `SUPABASE_SECRET_KEY` | Backend-only secret key — full database and storage access |

The NestJS server uses `@supabase/supabase-js` via `SupabaseService` (`src/supabase/supabase.service.ts`). Repositories read and write:

| Table | Used by |
|-------|---------|
| `products` | Product catalog, stock, search |
| `product_price_tiers` | Tiered pricing per product |
| `conversations` | Messenger PSID state machine |
| `orders` | Order lifecycle and slip metadata |
| `admin_notifications` | Admin alerts (future admin panel / Realtime) |

Storage bucket **`slips`** stores uploaded payment slip images. The backend uploads files and generates signed URLs for SlipOK verification.

Copy `.env.example` to `.env` and fill in these values before starting the server.

---

## Prerequisites

1. A [Supabase](https://supabase.com/) account.
2. This repo cloned locally with dependencies installed:

```bash
npm install
cp .env.example .env
```

3. (Optional) [Supabase CLI](https://supabase.com/docs/guides/cli) if you prefer CLI-based migrations instead of the SQL Editor.

---

## Step 1 — Create a Supabase project

1. Open [supabase.com/dashboard](https://supabase.com/dashboard).
2. Click **New project**.
3. Choose an **Organization**, enter a **Project name** and **Database password** (save the password — you need it for direct Postgres access).
4. Select a **Region** close to your users (e.g. Southeast Asia if most customers are in Thailand).
5. Wait for the project to finish provisioning.

---

## Step 2 — Get `SUPABASE_URL` and `SUPABASE_SECRET_KEY`

1. In the project dashboard, go to **Project Settings** (gear icon) → **API**.
2. Copy **Project URL** → set as `SUPABASE_URL` in `.env`:

```env
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
```

3. Under **Project API keys**, copy the **secret** key (labeled **Secret** or **service_role** depending on dashboard version; new projects use the `sb_secret_...` format) → set as `SUPABASE_SECRET_KEY`:

```env
SUPABASE_SECRET_KEY=sb_secret_...
```

**Important:**

| Key type | Where to use |
|----------|--------------|
| Secret / service role (`sb_secret_...`) | **This NestJS backend only** — bypasses Row Level Security |
| Publishable / anon key | Future browser admin panel only, with explicit RLS policies |

Never expose `SUPABASE_SECRET_KEY` in frontend code, Messenger payloads, or git.

If deploying to Vercel or another host, add the same variables in the platform’s environment settings and redeploy after changes.

---

## Step 3 — Run database migrations

Migration files live in `supabase/migrations/`:

| File | Purpose |
|------|---------|
| `001_initial_schema.sql` | Tables, indexes, RLS enable, `pg_trgm` extension |
| `002_seed_sample_product.sql` | Sample product “ใบพัดลม” with price tiers (dev/testing) |

### Option A — SQL Editor (recommended for first setup)

1. In Supabase dashboard, open **SQL Editor**.
2. Click **New query**.
3. Paste the full contents of `supabase/migrations/001_initial_schema.sql` → **Run**.
4. Confirm success (no errors in the results panel).
5. (Optional) Run `002_seed_sample_product.sql` the same way for test data.

### Option B — Supabase CLI

From the project root:

```bash
# One-time: link to your remote project
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF

# Apply all migrations in supabase/migrations/
npx supabase db push
```

`YOUR_PROJECT_REF` is the short ID in your project URL: `https://YOUR_PROJECT_REF.supabase.co`.

### What the schema creates

- **`products`** — catalog with generated `search_vector` (`simple` dictionary; app search uses `ilike` in `ProductRepository`)
- **`product_price_tiers`** — quantity-based unit pricing
- **`conversations`** — one row per Messenger PSID (`state`, `context` JSONB)
- **`orders`** — order records, slip URL, SlipOK `slip_transaction_id`
- **`admin_notifications`** — optional admin alerts

Row Level Security is **enabled** on all tables. The backend secret key bypasses RLS. If you add a browser admin UI later, define explicit RLS policies for the publishable key — do not rely on the secret key in the browser.

---

## Step 4 — Create the `slips` storage bucket

Slip images are uploaded by `SupabaseService.uploadSlip()` to a **private** bucket named `slips`.

### Via dashboard

1. Go to **Storage** → **Buckets** → **New bucket**.
2. **Name:** `slips`
3. **Public bucket:** Off (private)
4. Create the bucket.

### Via SQL (alternative)

Run in **SQL Editor**:

```sql
insert into storage.buckets (id, name, public)
values ('slips', 'slips', false)
on conflict (id) do nothing;
```

The backend uses the secret key, so no extra storage policies are required for server-side upload and signed URL generation. If you add client-side uploads later, add storage policies scoped to authenticated admin users.

---

## Step 5 — Verify the connection

1. Ensure `.env` has valid `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.
2. Start the app:

```bash
npm run start:dev
```

3. Check logs for:

```
Supabase client initialized
```

4. In Supabase dashboard → **Table Editor**, confirm tables exist and (if you ran the seed) a row in `products` named `ใบพัดลม`.

5. Optional SQL check in **SQL Editor**:

```sql
select count(*) from products;
select count(*) from product_price_tiers;
```

---

## Step 6 — Manage products (production data)

For production, add products through the Supabase dashboard or SQL instead of relying on the seed file.

**Example — insert a product with tiers:**

```sql
insert into products (name, description, stock_qty, is_active)
values ('ชื่อสินค้า', 'รายละเอียด', 1000, true)
returning id;

-- Use the returned id in the next inserts
insert into product_price_tiers (product_id, min_qty, unit_price, sort_order)
values
  ('PRODUCT_UUID_HERE', 1,   100.00, 2),
  ('PRODUCT_UUID_HERE', 10,   90.00, 1),
  ('PRODUCT_UUID_HERE', 100,  80.00, 0);
```

Tier selection logic uses the highest `min_qty` that is still ≤ order quantity (see `PricingService` in the codebase).

---

## How the app uses Supabase

```
NestJS API
    │
    ├── SupabaseService.getClient()
    │       └── PostgreSQL via PostgREST (products, orders, conversations, …)
    │
    └── SupabaseService.uploadSlip()
            └── Storage bucket `slips` → signed URL (1 hour) → SlipOK API
```

Repositories under `src/product/`, `src/order/`, and `src/conversation/` call `getClient()` for CRUD. Slip flow downloads the Facebook image, uploads to Storage, then passes the signed URL to SlipOK (Facebook URLs are not sent directly).

---

## Troubleshooting

### `Supabase client initialized` never appears / app crashes on startup

- `SUPABASE_URL` or `SUPABASE_SECRET_KEY` is missing or wrong in `.env`.
- On Vercel/hosting, confirm env vars are set for the correct environment and redeploy.

### `Product search failed` / `Failed to fetch` / PostgREST errors

- Migrations not applied — re-run `001_initial_schema.sql`.
- Wrong project linked (URL/ref mismatch with your keys).

### `Failed to upload slip: Bucket not found`

- Create the `slips` bucket (Step 4).
- Bucket name must be exactly `slips` (matches `supabase.service.ts`).

### `Failed to create signed URL`

- Confirm the upload succeeded (check **Storage → slips** in the dashboard).
- Secret key must have storage access (default for service/secret key).

### RLS / permission denied when using anon key

- Expected if testing with the publishable key without policies.
- This backend uses the **secret key only**; use that for server-side tests.

### Full-text search / Thai language

- Current migration uses `to_tsvector('simple', …)` and the app uses `ilike` search.
- For better Thai search later, consider `pg_trgm` indexes or a `thai` text search dictionary (see [technical-spec.md](./technical-spec.md) §9).

---

## Security reminders

| Item | Guidance |
|------|----------|
| `.env` | Listed in `.gitignore`; never commit secrets |
| `SUPABASE_SECRET_KEY` | Backend only; equivalent to database admin for API purposes |
| Storage `slips` | Private bucket; access via short-lived signed URLs |
| RLS | Enabled on all tables; secret key bypasses RLS — safe for server-only access |
| Future admin UI | Use publishable key + strict RLS policies; never embed secret key |

---

## Related project docs

- [technical-spec.md](./technical-spec.md) — schema details, domain types, architecture
- [facebook-messenger-setup.md](./facebook-messenger-setup.md) — Meta webhook and Page tokens
- `.env.example` — all environment variables for the full stack
- `supabase/migrations/` — versioned SQL migrations for this project
