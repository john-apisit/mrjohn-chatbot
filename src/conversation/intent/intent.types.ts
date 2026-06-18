export { Intent, INTENTS } from '../../common/types/domain.types';

export interface ClassifyInput {
  text: string;
  state: string;
  context: Record<string, unknown>;
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface IntentEntities {
  product_name?: string | null;
  quantity?: number | null;
  faq_topic?: string | null;
}

export interface IntentResult {
  intent: import('../../common/types/domain.types').Intent;
  entities: IntentEntities;
  confidence: number;
}

export const POSTBACK_INTENT_MAP: Record<string, string> = {
  GREETING: 'greeting',
  VIEW_PRODUCTS: 'product_inquiry',
  VIEW_FEATURED: 'product_inquiry',
  CHECK_ORDER: 'order_status',
  PLACE_ORDER: 'place_order',
  CONFIRM_ORDER: 'place_order',
  CHANGE_QUANTITY: 'place_order',
  VIEW_OTHER_PRODUCTS: 'product_inquiry',
  PRICE_QUOTE: 'price_quote',
  CHECK_STOCK: 'stock_check',
  SHOP_FAQ: 'shop_faq',
  ADD_MORE_PRODUCTS: 'product_inquiry',
  CLEAR_CART: 'cancel_order',
  CANCEL_ORDER: 'cancel_order',
};

const PRODUCT_BROWSE_TRIGGERS = new Set([
  'VIEW_PRODUCTS',
  'VIEW_OTHER_PRODUCTS',
  'VIEW_FEATURED',
  'ADD_MORE_PRODUCTS',
  'ดูสินค้า',
  'ดูสินค้าอื่น',
  'สินค้าแนะนำ',
]);

export function isProductBrowseTrigger(query: string): boolean {
  return PRODUCT_BROWSE_TRIGGERS.has(query.trim());
}
