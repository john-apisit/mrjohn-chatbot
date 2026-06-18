# Technical Spec: Facebook Page Chatbot

**Stack:** NestJS · Supabase · Facebook Messenger Platform API  
**วันที่:** June 2026

---

## 1. ภาพรวมระบบ (System Overview)

```
Facebook User
     │
     ▼ Messenger
Facebook Platform
     │
     ▼ Webhook POST /webhook
[NestJS API Server]
     │
     ├── AI Module (OpenAI / intent classification)
     ├── Product Module (stock / catalog)
     ├── Order Module (สร้าง order / ยอดชำระ)
     └── Slip Verification Module (SlipOK API)
          │
          ▼
     [Supabase]
     ├── PostgreSQL (products, orders, conversations)
     └── Storage (slip images)
```

---

## 2. Facebook Messenger Integration

### 2.1 Webhook Setup

Facebook ส่ง POST request มาที่ `/webhook` ทุกครั้งที่มี event เช่น ข้อความใหม่, postback, หรือ delivery

```
GET  /webhook  → Verify token (ตอน setup ครั้งแรก)
POST /webhook  → รับ message events ทั้งหมด
```

**Verify Token Flow:**
1. Admin กรอก Verify Token ใน Facebook Developer Console
2. Facebook ส่ง GET `/webhook?hub.mode=subscribe&hub.verify_token=xxx&hub.challenge=yyy`
3. Server ตรวจสอบ token แล้ว respond ด้วย `hub.challenge`

**Message Event Payload ตัวอย่าง:**
```json
{
  "object": "page",
  "entry": [{
    "id": "PAGE_ID",
    "messaging": [{
      "sender": { "id": "USER_PSID" },
      "recipient": { "id": "PAGE_ID" },
      "timestamp": 1234567890,
      "message": {
        "mid": "mid.xxx",
        "text": "มีสินค้า X ไหมครับ"
      }
    }]
  }]
}
```

### 2.2 Sending Messages

ใช้ Facebook Send API:
```
POST https://graph.facebook.com/v19.0/me/messages
Authorization: Bearer PAGE_ACCESS_TOKEN
```

รองรับหลาย message type:
- **Text** → ตอบข้อความธรรมดา
- **Quick Replies** → ปุ่มเลือกเร็ว เช่น "ดูสินค้า", "เช็คออเดอร์"
- **Generic Template** → การ์ดสินค้า มีรูป ชื่อ ราคา ปุ่ม
- **Button Template** → ปุ่ม CTA เช่น "ยืนยันออเดอร์"

---

## 3. โมดูลหลัก (Core Modules)

### 3.1 Webhook Module

**ไฟล์:** `src/webhook/webhook.controller.ts`

หน้าที่:
- รับ webhook event จาก Facebook
- ตรวจสอบ `X-Hub-Signature-256` header (HMAC SHA256 ของ App Secret)
- ส่งต่อ messaging event ไปยัง `ConversationService`

```typescript
// pseudocode flow
@Post()
async handleWebhook(@Body() body, @Headers() headers) {
  verifySignature(headers['x-hub-signature-256'], body);
  
  for (const entry of body.entry) {
    for (const event of entry.messaging) {
      await this.conversationService.handleEvent(event);
    }
  }
  return 'EVENT_RECEIVED';
}
```

---

### 3.2 Conversation / Intent Module

**ไฟล์:** `src/conversation/`

**Intent Classification** — วิธีแยกว่าผู้ใช้ต้องการอะไร:

| Intent | ตัวอย่างข้อความ | Action |
|--------|----------------|--------|
| `greeting` | สวัสดี, หวัดดี | ทักทาย + แสดง quick replies |
| `product_inquiry` | มีสินค้า X ไหม, ราคาเท่าไหร่ | ค้นหาสินค้า |
| `stock_check` | เหลือกี่ชิ้น, มีของไหม | เช็ค stock |
| `place_order` | ขอสั่ง X ชิ้น, อยากได้ X | สร้าง order draft |
| `payment_inquiry` | ต้องโอนเท่าไหร่, ยอดชำระ | แจ้งยอด |
| `slip_upload` | ส่งรูปสลิป (attachment type=image) | ตรวจสลิป |
| `order_status` | ออเดอร์ถึงไหนแล้ว | เช็คสถานะ |
| `fallback` | อื่นๆ | ตอบ default / escalate to admin |

**Classification Strategy — LLM-based**

ใช้ **OpenAI GPT-4o-mini** classify intent ทุกข้อความ (ยกเว้น attachment รูป → route ไป `slip_upload` โดยตรง)

**Flow:**
```
user message + conversation state + 3-5 ข้อความล่าสุด
       ↓
GPT-4o-mini (structured output)
       ↓
{ intent, entities, confidence }
       ↓
ConversationService route ไป handler ที่ถูกต้อง
```

**System prompt ควรมี:**
- บทบาท bot (แอดมินร้าน, ตอบภาษาไทย)
- รายการ intent ที่รองรับ (ตามตารางด้านบน)
- `conversation.state` ปัจจุบัน เช่น `awaiting_quantity` → บังคับ intent เป็น `place_order`
- ชื่อร้าน / นโยบายพื้นฐาน

**Structured output ตัวอย่าง:**
```json
{
  "intent": "product_inquiry",
  "entities": {
    "product_name": "หมวก Cap สีดำ",
    "quantity": null
  },
  "confidence": 0.92
}
```

**Implementation (`intent.classifier.ts`):**
```typescript
async classify(input: ClassifyInput): Promise<IntentResult> {
  const response = await this.openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: this.buildSystemPrompt(input.state, input.context) },
      ...input.recentMessages,
      { role: 'user', content: input.text },
    ],
  });
  return JSON.parse(response.choices[0].message.content);
}
```

**กฎพิเศษ (ไม่ผ่าน LLM):**
| Event | Intent ที่ใช้ |
|-------|---------------|
| attachment type = `image` + state = `awaiting_slip` | `slip_upload` |
| postback จาก quick reply / button | map จาก payload โดยตรง |

**ค่าใช้จ่าย:** ~$0.0001 ต่อ message (~150 input tokens + 50 output tokens)

**Fallback:** ถ้า `confidence < 0.7` หรือ LLM error → intent = `fallback` + แจ้ง admin

**Conversation State** (เก็บใน Supabase):

DB ใช้ `text` — ใน code ใช้ `ConversationState` literal type (ดู [§4.1](#41-typescript-literal-types))

```sql
-- ตาราง conversations
id uuid
psid text
state text         -- → ConversationState
context jsonb      -- → ConversationContext
updated_at timestamptz
```

---

### 3.3 Product Module

**ไฟล์:** `src/product/`

**Database Schema:**
```sql
-- ตาราง products
id uuid primary key
name text not null
description text
stock_qty integer not null default 0
image_url text
is_active boolean default true
created_at timestamptz default now()

-- ตาราง product_price_tiers (ราคาตามจำนวน)
id uuid primary key
product_id uuid not null references products(id) on delete cascade
min_qty integer not null          -- ซื้อขั้นต่ำ X ชิ้นขึ้นไป
unit_price numeric(10,2) not null -- ตกชิ้นละ Y บาท
sort_order integer not null default 0
unique (product_id, min_qty)
```

**กฎการคิดราคา (Volume Pricing):**

เลือก tier ที่ `min_qty <= จำนวนที่สั่ง` และมี `min_qty` สูงสุด (ราคาถูกที่สุดที่เข้าเงื่อนไข)

```
ตัวอย่าง: ใบพัดลม
┌─────────────┬──────────────┐
│ min_qty     │ unit_price   │
├─────────────┼──────────────┤
│ 10,000      │ 5.00 บาท/ชิ้น │
│ 100         │ 7.00 บาท/ชิ้น │
│ 1           │ 10.00 บาท/ชิ้น│  ← ราคาปลีก (optional)
└─────────────┴──────────────┘

สั่ง 150 ชิ้น  → tier 100  → 7 บาท/ชิ้น  → รวม 1,050 บาท
สั่ง 10,000 ชิ้น → tier 10,000 → 5 บาท/ชิ้น → รวม 50,000 บาท
สั่ง 50 ชิ้น   → tier 1    → 10 บาท/ชิ้น → รวม 500 บาท
```

**Pricing Logic (`pricing.service.ts`):**
```typescript
function resolveUnitPrice(tiers: PriceTier[], quantity: number): PriceTier {
  const applicable = tiers
    .filter(t => quantity >= t.min_qty)
    .sort((a, b) => b.min_qty - a.min_qty);  // เอา tier สูงสุดที่เข้าเงื่อนไข

  if (!applicable.length) {
    throw new Error('Quantity below minimum order');
  }
  return applicable[0];
}

function calcLineTotal(tier: PriceTier, quantity: number) {
  return tier.unit_price * quantity;
}
```

**Features:**
- `searchProducts(query: string)` → full-text search ด้วย `to_tsvector` ของ Supabase
- `getProductById(id)` → ดึงข้อมูลสินค้า + stock + price tiers
- `getPriceTiers(productId)` → รายการ tier เรียงตาม min_qty DESC
- `resolvePrice(productId, qty)` → คืน `{ unit_price, min_qty, line_total }`
- `checkStock(id, qty)` → ตรวจ stock คงเหลือ
- `reserveStock(id, qty)` → lock stock ตอนรอชำระ (optimistic locking)

**ตัวอย่าง response สินค้า (product_inquiry):**
```
📦 สินค้า: ใบพัดลม
📊 คงเหลือ: 50,000 ชิ้น

💰 ราคาตามจำนวน:
   • 10,000 ชิ้นขึ้นไป → 5 บาท/ชิ้น
   • 100 ชิ้นขึ้นไป    → 7 บาท/ชิ้น
   • 1 ชิ้นขึ้นไป      → 10 บาท/ชิ้น

[สั่งซื้อ] [ดูสินค้าอื่น]
```

**ตัวอย่าง response หลังระบุจำนวน (place_order):**
```
📦 ใบพัดลม × 150 ชิ้น
💰 7 บาท/ชิ้น (ขั้นต่ำ 100 ชิ้น)
━━━━━━━━━━━━━━━━
💵 รวม: 1,050 บาท

[ยืนยันออเดอร์] [เปลี่ยนจำนวน]
```

---

### 3.4 Order Module

**ไฟล์:** `src/order/`

**Database Schema:**

DB ใช้ `text` / `jsonb` — ใน code ใช้ literal types (ดู [§4.1](#41-typescript-literal-types))

```sql
-- ตาราง orders
id uuid primary key
psid text not null
order_number text unique
status text                  -- → OrderStatus
items jsonb                  -- → OrderItem[]
total_amount numeric(10,2)
shipping_address text
slip_url text
slip_verified boolean default false
created_at timestamptz default now()
updated_at timestamptz
```

**Order Flow:**
```
1. user พิมพ์ชื่อสินค้า
       ↓
2. bot แสดงสินค้า → ถามจำนวน (state: awaiting_quantity)
       ↓
3. user ตอบจำนวน → คำนวณราคาจาก tier ที่เข้าเงื่อนไข
       ↓
4. bot สรุปออเดอร์ + แจ้งยอด + แจ้งเลขบัญชี (state: awaiting_slip)
       ↓
5. user ส่งรูปสลิป
       ↓
6. bot ตรวจสลิป → confirm / reject
       ↓
7. ถ้า confirm → status = paid → แจ้ง admin
```

---

### 3.5 Slip Verification Module

**ไฟล์:** `src/slip/`

**Provider:** [SlipOK Check Slip API](https://slipok.com/api-documentation/check-slip/)

SlipOK เป็นบริการตรวจสลิปไทยที่รองรับสลิปธนาคารทุกธนาคาร ตรวจความถูกต้องของสลิป ยอดเงิน บัญชีผู้รับ และสลิปซ้ำได้ในครั้งเดียว

#### Setup (ครั้งแรก)

1. สมัครที่ [slipok.com](https://slipok.com/) ผ่าน LINE
2. สร้างร้าน + สาขา แล้วกรอก **เลขบัญชี/ชื่อบัญชีผู้รับ** ที่ใช้รับเงินจริง
3. ตั้งค่า tolerance โอนขาด/โอนเกินใน SlipOK dashboard
4. เก็บค่า 2 ตัวนี้ไว้ใน env:
   - `SLIPOK_BRANCH_ID` → ไอดีสาขา (อยู่ใน URL endpoint)
   - `SLIPOK_API_KEY` → API Key

#### API Call

```
POST https://api.slipok.com/api/line/apikey/{SLIPOK_BRANCH_ID}
Header: x-authorization: {SLIPOK_API_KEY}
Content-Type: application/json
```

**Request body (เลือกได้ 1 ใน 3 วิธี):**

| Field | คำอธิบาย |
|-------|----------|
| `url` | URL รูปสลิป (public accessible) |
| `data` | ข้อมูล QR Code จากสลิป |
| `files` | multipart upload ไฟล์รูป (.jpg .jpeg .png .jfif .webp) |
| `amount` | ยอดที่คาดหวัง (optional — SlipOK จะเช็คให้) |
| `log` | `true` = บันทึกประวัติ + กันสลิปซ้ำ (แนะนำ) |

**ตัวอย่าง request:**
```json
{
  "url": "https://xxx.supabase.co/storage/v1/object/sign/slips/abc.jpg",
  "amount": 350,
  "log": true
}
```

**Response สำเร็จ:**
```json
{
  "success": true,
  "data": {
    "transRef": "010092101507665143",
    "transDate": "20200401",
    "transTime": "10:15:07",
    "amount": 350,
    "sender": {
      "displayName": "นาย สมชาย ใ",
      "account": { "value": "xxx-x-x0209-x" }
    },
    "receiver": {
      "displayName": "กสิกร ร",
      "account": { "value": "xxx-x-x3109-x" }
    }
  }
}
```

**Response ล้มเหลว:**
```json
{
  "code": 1012,
  "message": "สลิปซ้ำ สลิปนี้เคยส่งเข้ามาในระบบเมื่อ ..."
}
```

#### Error Codes ที่ควร handle

| Code | ความหมาย | Action ของ bot |
|------|----------|----------------|
| 1006 | รูปภาพไม่ถูกต้อง | ขอให้ส่งใหม่ |
| 1007 | รูปไม่มี QR Code | ขอให้ส่งสลิปที่ชัดขึ้น |
| 1011 | QR หมดอายุ / ไม่มีรายการจริง | แจ้ง user + escalate admin |
| 1012 | สลิปซ้ำ | แจ้ง user ว่าเคยตรวจแล้ว |
| 1013 | ยอดไม่ตรง | แจ้งยอดที่ถูกต้อง |
| 1014 | บัญชีผู้รับไม่ตรง | escalate admin |

#### Integration Flow (Facebook → SlipOK)

```
1. user ส่งรูปสลิป (attachment type=image)
       ↓
2. ดาวน์โหลดรูปจาก Facebook CDN URL
       ↓
3. อัปโหลดไป Supabase Storage → ได้ signed URL
       ↓
4. เรียก SlipOK API (url + amount + log:true)
       ↓
5. success → update order status = paid, เก็บ transRef
   fail    → ตอบ user ตาม error code + แจ้ง admin
```

> **หมายเหตุ:** Facebook image URL มักเข้าถึงได้เฉพาะด้วย Page Access Token จึงควรดาวน์โหลดแล้ว upload ไป Supabase Storage ก่อนส่ง URL ให้ SlipOK แทนการส่ง Facebook URL ตรงๆ

#### NestJS Service (pseudocode)

```typescript
@Injectable()
export class SlipService {
  async verifySlipFromImage(
    imageBuffer: Buffer,
    expectedAmount: number,
  ): Promise<SlipOkResult> {
    // 1. upload to Supabase Storage
    const signedUrl = await this.storage.uploadSlip(imageBuffer);

    // 2. call SlipOK
    const res = await fetch(
      `https://api.slipok.com/api/line/apikey/${this.branchId}`,
      {
        method: 'POST',
        headers: {
          'x-authorization': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: signedUrl,
          amount: expectedAmount,
          log: true,
        }),
      },
    );

    const data = await res.json();

    if (!data.success) {
      return { ok: false, code: data.code, message: data.message };
    }

    return {
      ok: true,
      transRef: data.data.transRef,
      amount: data.data.amount,
      transDate: data.data.transDate,
      transTime: data.data.transTime,
    };
  }
}
```

#### ค่าใช้จ่าย SlipOK

- ฟรี 100 สลิป/เดือน (2 ร้าน)
- 500 สลิป/เดือน = 210 บาท
- 1,000 สลิป/เดือน = 360 บาท
- ส่งสลิปซ้ำไม่นับโควต้า (เมื่อ `log: true`)

---

## 4. Database Schema (Supabase)

```sql
-- Row Level Security ควร enable ทุกตาราง
-- Admin จัดการผ่าน Supabase Dashboard หรือ admin panel แยก

create table products (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  description text,
  stock_qty integer not null default 0,
  image_url text,
  is_active boolean default true,
  search_vector tsvector generated always as (to_tsvector('thai', name || ' ' || coalesce(description,''))) stored,
  created_at timestamptz default now()
);
create index on products using gin(search_vector);

create table product_price_tiers (
  id uuid default gen_random_uuid() primary key,
  product_id uuid not null references products(id) on delete cascade,
  min_qty integer not null check (min_qty > 0),
  unit_price numeric(10,2) not null check (unit_price > 0),
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  unique (product_id, min_qty)
);
create index on product_price_tiers (product_id, min_qty desc);

create table conversations (
  id uuid default gen_random_uuid() primary key,
  psid text not null unique,
  state text not null default 'idle',  -- → ConversationState
  context jsonb default '{}',          -- → ConversationContext
  updated_at timestamptz default now()
);

create table orders (
  id uuid default gen_random_uuid() primary key,
  psid text not null,
  order_number text unique not null,
  status text not null default 'draft',  -- → OrderStatus
  items jsonb not null default '[]',     -- → OrderItem[]
  total_amount numeric(10,2),
  shipping_address text,
  slip_url text,
  slip_verified boolean default false,
  slip_transaction_id text unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table admin_notifications (
  id uuid default gen_random_uuid() primary key,
  type text,         -- → AdminNotificationType
  order_id uuid references orders(id),
  payload jsonb,
  is_read boolean default false,
  created_at timestamptz default now()
);
```

### 4.1 TypeScript Literal Types

ฟิลด์ที่มีค่าจำกัด (enum-like) **เก็บเป็น `text` ใน DB** แต่ใน NestJS ใช้ **string literal union types** เป็นหลัก — ไม่ใช้ TypeScript `enum` และไม่ใช้ PostgreSQL `enum`

**Convention:**
- ประกาศ type ไว้ที่ `src/common/types/`
- Repository อ่าน/เขียน DB เป็น `string` แล้ว cast/validate เป็น literal type ตอน boundary
- ใช้ `as const` array + derived type เพื่อ single source of truth

**ไฟล์:** `src/common/types/domain.types.ts`

```typescript
// ── Intent ──────────────────────────────────────────
export const INTENTS = [
  'greeting',
  'product_inquiry',
  'stock_check',
  'place_order',
  'payment_inquiry',
  'slip_upload',
  'order_status',
  'fallback',
] as const;
export type Intent = (typeof INTENTS)[number];

// ── Conversation State ──────────────────────────────
export const CONVERSATION_STATES = [
  'idle',
  'awaiting_quantity',
  'awaiting_order_confirm',
  'awaiting_slip',
] as const;
export type ConversationState = (typeof CONVERSATION_STATES)[number];

export interface ConversationContext {
  pending_product_id?: string;
  pending_order_id?: string;
  pending_quantity?: number;
}

// ── Order ───────────────────────────────────────────
export const ORDER_STATUSES = [
  'draft',
  'pending_payment',
  'paid',
  'shipped',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface OrderItem {
  product_id: string;
  name: string;
  qty: number;
  unit_price: number;
  min_qty_tier: number;
  line_total: number;
}

// ── Admin Notification ────────────────────────────
export const ADMIN_NOTIFICATION_TYPES = [
  'new_order',
  'payment_received',
  'slip_error',
] as const;
export type AdminNotificationType = (typeof ADMIN_NOTIFICATION_TYPES)[number];
```

**Type guard สำหรับ validate ค่าจาก DB:**

```typescript
// src/common/types/guards.ts
export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

export function isConversationState(value: string): value is ConversationState {
  return (CONVERSATION_STATES as readonly string[]).includes(value);
}
```

**การใช้ใน Repository:**

```typescript
// อ่านจาก Supabase
const row = data as { state: string; status: string; items: OrderItem[] };

if (!isConversationState(row.state)) {
  throw new Error(`Invalid conversation state: ${row.state}`);
}

// เขียนลง Supabase — literal type assign ได้กับ text column โดยตรง
await supabase.from('orders').update({ status: 'paid' satisfies OrderStatus });
```

**State transition ที่อนุญาต:**

```typescript
const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft:            ['pending_payment', 'cancelled'],
  pending_payment:  ['paid', 'cancelled'],
  paid:             ['shipped', 'cancelled'],
  shipped:          [],
  cancelled:        [],
};

const CONVERSATION_STATE_TRANSITIONS: Record<ConversationState, ConversationState[]> = {
  idle:                    ['awaiting_quantity'],
  awaiting_quantity:       ['awaiting_order_confirm', 'idle'],
  awaiting_order_confirm:  ['awaiting_slip', 'awaiting_quantity', 'idle'],
  awaiting_slip:             ['idle'],
};
```

---

## 5. NestJS Project Structure

```
src/
├── app.module.ts
├── main.ts
│
├── common/
│   └── types/
│       ├── domain.types.ts     ← literal union types (Intent, OrderStatus, …)
│       └── guards.ts           ← type guards สำหรับ validate ค่าจาก DB
│
├── webhook/
│   ├── webhook.module.ts
│   ├── webhook.controller.ts   ← รับ POST /webhook
│   └── webhook.service.ts      ← verify signature
│
├── conversation/
│   ├── conversation.module.ts
│   ├── conversation.service.ts ← state machine, intent routing
│   └── intent/
│       ├── intent.classifier.ts  ← GPT-4o-mini structured output
│       └── intent.types.ts       ← re-export Intent จาก domain.types
│
├── product/
│   ├── product.module.ts
│   ├── product.service.ts
│   ├── product.repository.ts
│   └── pricing.service.ts      ← คำนวณราคาตาม tier
│
├── order/
│   ├── order.module.ts
│   ├── order.service.ts
│   └── order.repository.ts
│
├── slip/
│   ├── slip.module.ts
│   └── slip.service.ts         ← ตรวจสลิป
│
├── messenger/
│   ├── messenger.module.ts
│   └── messenger.service.ts    ← ส่งข้อความกลับ Facebook
│
└── supabase/
    ├── supabase.module.ts
    └── supabase.service.ts     ← Supabase client provider
```

---

## 6. Environment Variables

```env
# Facebook
FACEBOOK_APP_SECRET=
FACEBOOK_VERIFY_TOKEN=
FACEBOOK_PAGE_ACCESS_TOKEN=

# Supabase
SUPABASE_URL=
SUPABASE_SECRET_KEY=

# SlipOK
SLIPOK_API_KEY=
SLIPOK_BRANCH_ID=

# OpenAI (intent classification)
OPENAI_API_KEY=

# Shop Bank Account
SHOP_BANK_ACCOUNT=xxx-x-xxxxx-x
SHOP_BANK_NAME=กสิกรไทย
SHOP_ACCOUNT_NAME=ชื่อร้าน
```

---

## 7. Security

| เรื่อง | วิธีจัดการ |
|--------|-----------|
| Webhook signature | ตรวจ `X-Hub-Signature-256` HMAC ทุก request |
| Rate limiting | NestJS `@nestjs/throttler` — จำกัด 30 req/min ต่อ PSID |
| Slip duplicate | SlipOK `log: true` กันสลิปซ้ำ + เก็บ `transRef` ใน DB |
| Supabase access | ใช้ secret key (`sb_secret_...`) เฉพาะ backend เท่านั้น |
| Image storage | Supabase Storage + signed URL มีอายุ |

---

## 8. Admin Notification

เมื่อมี order ใหม่หรือสลิปผ่านการตรวจ ให้แจ้ง admin ผ่าน:

- **Facebook Page Inbox** — ส่ง message ไปยัง admin PSID (ต้องตั้งค่า admin PSID ไว้ใน env)
- **Supabase Realtime** — subscribe ตาราง `admin_notifications` ใน admin panel

---

## 9. ข้อจำกัดที่ควรรู้

1. **Facebook 24-hour rule** — bot ตอบได้ฟรีภายใน 24 ชั่วโมงหลัง user ส่งข้อความล่าสุด หลังจากนั้นต้องใช้ Message Tags หรือ Sponsored Messages
2. **PSID ไม่ใช่ user ID จริง** — Page-Scoped ID เปลี่ยนตาม Page ต่างกันได้ เก็บ link กับ order ได้แต่ไม่ควรใช้ authenticate ระบบอื่น
3. **Webhook ต้อง respond ภายใน 20 วินาที** — งานหนักเช่น OCR ให้ทำ async แล้วตอบกลับ user ทีหลัง
4. **Thai language full-text search** — Supabase/PostgreSQL ใช้ `pg_trgm` หรือ dictionary `thai` (ต้องติดตั้ง extension เพิ่ม) หรือใช้ `ilike '%keyword%'` สำหรับเริ่มต้น
