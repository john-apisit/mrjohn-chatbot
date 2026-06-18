export interface QuickReply {
  content_type: 'text';
  title: string;
  payload: string;
}

export interface SendMessagePayload {
  recipient: { id: string };
  message: {
    text?: string;
    attachment?: {
      type: 'template';
      payload: {
        template_type: 'generic' | 'button';
        text?: string;
        elements?: Array<{
          title: string;
          subtitle?: string;
          image_url?: string;
          buttons?: Array<{
            type: 'postback';
            title: string;
            payload: string;
          }>;
        }>;
        buttons?: Array<{
          type: 'postback';
          title: string;
          payload: string;
        }>;
      };
    };
    quick_replies?: QuickReply[];
  };
  messaging_type?: 'RESPONSE' | 'UPDATE';
}

export interface FacebookMessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    quick_reply?: {
      payload: string;
    };
    attachments?: Array<{
      type: string;
      payload: { url?: string; sticker_id?: number };
    }>;
  };
  postback?: {
    title: string;
    payload: string;
  };
}

export interface FacebookWebhookBody {
  object: string;
  entry: Array<{
    id: string;
    messaging: FacebookMessagingEvent[];
  }>;
}
