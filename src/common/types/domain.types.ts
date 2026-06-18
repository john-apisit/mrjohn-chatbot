export const INTENTS = [
  'greeting',
  'product_inquiry',
  'stock_check',
  'price_quote',
  'place_order',
  'payment_inquiry',
  'slip_upload',
  'order_status',
  'shop_faq',
  'cancel_order',
  'fallback',
] as const;
export type Intent = (typeof INTENTS)[number];

export const CONVERSATION_STATES = [
  'idle',
  'awaiting_quantity',
  'awaiting_order_confirm',
  'awaiting_slip',
  'awaiting_price_quote_qty',
] as const;
export type ConversationState = (typeof CONVERSATION_STATES)[number];

export interface CartItem {
  product_id: string;
  name: string;
  qty: number;
  unit_price: number;
  min_qty_tier: number;
  line_total: number;
}

export interface ConversationContext {
  pending_product_id?: string;
  pending_order_id?: string;
  pending_quantity?: number;
  last_product_id?: string;
  cart_items?: CartItem[];
  price_quote_product_id?: string;
}

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

export const ADMIN_NOTIFICATION_TYPES = [
  'new_order',
  'payment_received',
  'slip_error',
] as const;
export type AdminNotificationType =
  (typeof ADMIN_NOTIFICATION_TYPES)[number];

export const ORDER_STATUS_TRANSITIONS: Record<
  OrderStatus,
  OrderStatus[]
> = {
  draft: ['pending_payment', 'cancelled'],
  pending_payment: ['paid', 'cancelled'],
  paid: ['shipped', 'cancelled'],
  shipped: [],
  cancelled: [],
};

export const CONVERSATION_STATE_TRANSITIONS: Record<
  ConversationState,
  ConversationState[]
> = {
  idle: ['awaiting_quantity', 'awaiting_price_quote_qty'],
  awaiting_quantity: ['awaiting_order_confirm', 'idle'],
  awaiting_order_confirm: ['awaiting_slip', 'awaiting_quantity', 'idle'],
  awaiting_slip: ['idle'],
  awaiting_price_quote_qty: ['idle'],
};
