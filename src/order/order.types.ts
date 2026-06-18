import {
  ConversationContext,
  ConversationState,
  OrderItem,
  OrderStatus,
} from '../common/types/domain.types';

export interface OrderRow {
  id: string;
  psid: string;
  order_number: string;
  status: OrderStatus;
  items: OrderItem[];
  total_amount: number | null;
  shipping_address: string | null;
  slip_url: string | null;
  slip_verified: boolean;
  slip_transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationRow {
  id: string;
  psid: string;
  state: ConversationState;
  context: ConversationContext;
  updated_at: string;
}

export interface AdminNotificationRow {
  id: string;
  type: string;
  order_id: string | null;
  payload: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
}
