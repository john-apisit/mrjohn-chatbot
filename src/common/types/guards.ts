import {
  ADMIN_NOTIFICATION_TYPES,
  AdminNotificationType,
  CONVERSATION_STATES,
  ConversationState,
  INTENTS,
  Intent,
  ORDER_STATUSES,
  OrderStatus,
} from './domain.types';

export function isIntent(value: string): value is Intent {
  return (INTENTS as readonly string[]).includes(value);
}

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

export function isConversationState(
  value: string,
): value is ConversationState {
  return (CONVERSATION_STATES as readonly string[]).includes(value);
}

export function isAdminNotificationType(
  value: string,
): value is AdminNotificationType {
  return (ADMIN_NOTIFICATION_TYPES as readonly string[]).includes(value);
}
