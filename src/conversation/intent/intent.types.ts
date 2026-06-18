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
}

export interface IntentResult {
  intent: import('../../common/types/domain.types').Intent;
  entities: IntentEntities;
  confidence: number;
}

export const POSTBACK_INTENT_MAP: Record<string, string> = {
  GREETING: 'greeting',
  VIEW_PRODUCTS: 'product_inquiry',
  CHECK_ORDER: 'order_status',
  PLACE_ORDER: 'place_order',
  CONFIRM_ORDER: 'place_order',
  CHANGE_QUANTITY: 'place_order',
  VIEW_OTHER_PRODUCTS: 'product_inquiry',
};
