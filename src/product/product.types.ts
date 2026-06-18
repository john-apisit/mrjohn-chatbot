export interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  stock_qty: number;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
}

export interface PriceTierRow {
  id: string;
  product_id: string;
  min_qty: number;
  unit_price: number;
  sort_order: number;
}

export interface ProductWithTiers extends ProductRow {
  price_tiers: PriceTierRow[];
}

export interface ResolvedPrice {
  unit_price: number;
  min_qty: number;
  line_total: number;
}
