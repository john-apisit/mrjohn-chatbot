import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QuickReply, SendMessagePayload } from './messenger.types';

const GRAPH_API = 'https://graph.facebook.com/v19.0/me/messages';

@Injectable()
export class MessengerService {
  private readonly logger = new Logger(MessengerService.name);
  private readonly pageAccessToken: string;
  private readonly adminPsid: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.pageAccessToken = this.config.getOrThrow<string>(
      'FACEBOOK_PAGE_ACCESS_TOKEN',
    );
    this.adminPsid = this.config.get<string>('ADMIN_PSID');
  }

  async sendText(psid: string, text: string): Promise<void> {
    await this.send({ recipient: { id: psid }, message: { text } });
  }

  async sendQuickReplies(
    psid: string,
    text: string,
    quickReplies: QuickReply[],
  ): Promise<void> {
    await this.send({
      recipient: { id: psid },
      message: { text, quick_replies: quickReplies },
    });
  }

  async sendButtonTemplate(
    psid: string,
    text: string,
    buttons: Array<{ title: string; payload: string }>,
  ): Promise<void> {
    await this.send({
      recipient: { id: psid },
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button',
            text,
            buttons: buttons.map((b) => ({
              type: 'postback' as const,
              title: b.title,
              payload: b.payload,
            })),
          },
        },
      },
    });
  }

  /** ปุ่มเรียงแนวตั้ง (สูงสุด 3 ปุ่มต่อข้อความ — แบ่งเป็นหลายข้อความถ้าเกิน) */
  async sendVerticalButtons(
    psid: string,
    text: string,
    buttons: Array<{ title: string; payload: string }>,
  ): Promise<void> {
    const maxPerMessage = 3;
    for (let i = 0; i < buttons.length; i += maxPerMessage) {
      const chunk = buttons.slice(i, i + maxPerMessage);
      const messageText = i === 0 ? text : '👇 เลือกต่อได้เลยค่ะ';
      await this.sendButtonTemplate(psid, messageText, chunk);
    }
  }

  async sendGenericTemplate(
    psid: string,
    elements: Array<{
      title: string;
      subtitle?: string;
      image_url?: string;
      buttons?: Array<{ title: string; payload: string }>;
    }>,
  ): Promise<void> {
    await this.send({
      recipient: { id: psid },
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'generic',
            elements: elements.map((el) => ({
              title: el.title,
              subtitle: el.subtitle,
              image_url: el.image_url,
              buttons: el.buttons?.map((b) => ({
                type: 'postback' as const,
                title: b.title,
                payload: b.payload,
              })),
            })),
          },
        },
      },
    });
  }

  async notifyAdmin(text: string): Promise<void> {
    if (!this.adminPsid) {
      this.logger.warn('ADMIN_PSID not configured, skipping admin message');
      return;
    }
    await this.sendText(this.adminPsid, `🔔 Admin: ${text}`);
  }

  getPageAccessToken(): string {
    return this.pageAccessToken;
  }

  private async send(payload: SendMessagePayload): Promise<void> {
    try {
      const res = await fetch(`${GRAPH_API}?access_token=${this.pageAccessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.text();
        this.logger.error(`Facebook Send API error: ${res.status} ${body}`);
      }
    } catch (err) {
      this.logger.error('Failed to send Facebook message', err);
    }
  }
}
