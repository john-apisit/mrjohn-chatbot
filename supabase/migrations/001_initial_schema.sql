-- Enable extensions
create extension if not exists "pg_trgm";

-- Products
create table products (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  description text,
  stock_qty integer not null default 0,
  image_url text,
  is_active boolean default true,
  search_vector tsvector generated always as (
    to_tsvector('simple', name || ' ' || coalesce(description, ''))
  ) stored,
  created_at timestamptz default now()
);
create index products_search_vector_idx on products using gin(search_vector);

-- Product price tiers
create table product_price_tiers (
  id uuid default gen_random_uuid() primary key,
  product_id uuid not null references products(id) on delete cascade,
  min_qty integer not null check (min_qty > 0),
  unit_price numeric(10,2) not null check (unit_price > 0),
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  unique (product_id, min_qty)
);
create index product_price_tiers_product_id_min_qty_idx
  on product_price_tiers (product_id, min_qty desc);

-- Conversations
create table conversations (
  id uuid default gen_random_uuid() primary key,
  psid text not null unique,
  state text not null default 'idle',
  context jsonb default '{}',
  updated_at timestamptz default now()
);

-- Orders
create table orders (
  id uuid default gen_random_uuid() primary key,
  psid text not null,
  order_number text unique not null,
  status text not null default 'draft',
  items jsonb not null default '[]',
  total_amount numeric(10,2),
  shipping_address text,
  slip_url text,
  slip_verified boolean default false,
  slip_transaction_id text unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index orders_psid_idx on orders (psid);
create index orders_status_idx on orders (status);

-- Admin notifications
create table admin_notifications (
  id uuid default gen_random_uuid() primary key,
  type text,
  order_id uuid references orders(id),
  payload jsonb,
  is_read boolean default false,
  created_at timestamptz default now()
);

-- Row Level Security
alter table products enable row level security;
alter table product_price_tiers enable row level security;
alter table conversations enable row level security;
alter table orders enable row level security;
alter table admin_notifications enable row level security;

-- Storage bucket for slip images (run via Supabase dashboard or API)
-- insert into storage.buckets (id, name, public) values ('slips', 'slips', false);
