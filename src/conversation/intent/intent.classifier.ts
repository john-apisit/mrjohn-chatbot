import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { INTENTS, Intent } from '../../common/types/domain.types';
import { isIntent } from '../../common/types/guards';
import { ClassifyInput, IntentResult } from './intent.types';

@Injectable()
export class IntentClassifier {
  private readonly logger = new Logger(IntentClassifier.name);
  private readonly openai: OpenAI;
  private readonly shopName: string;

  constructor(private readonly config: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.config.getOrThrow<string>('OPENAI_API_KEY'),
    });
    this.shopName =
      this.config.get<string>('SHOP_ACCOUNT_NAME') ?? 'ร้านของเรา';
  }

  async classify(input: ClassifyInput): Promise<IntentResult> {
    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: this.buildSystemPrompt(input.state, input.context),
          },
          ...input.recentMessages.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
          { role: 'user', content: input.text },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return this.fallbackResult();
      }

      const parsed = JSON.parse(content) as IntentResult;
      if (!isIntent(parsed.intent)) {
        return this.fallbackResult();
      }
      if (parsed.confidence < 0.7) {
        return { ...parsed, intent: 'fallback' };
      }
      return parsed;
    } catch (err) {
      this.logger.error('Intent classification failed', err);
      return this.fallbackResult();
    }
  }

  private fallbackResult(): IntentResult {
    return {
      intent: 'fallback',
      entities: {},
      confidence: 0,
    };
  }

  private buildSystemPrompt(
    state: string,
    context: Record<string, unknown>,
  ): string {
    const stateHint = this.getStateHint(state);
    return `คุณเป็นแอดมินร้าน "${this.shopName}" ที่ตอบแชท Facebook Messenger เป็นภาษาไทย
งานของคุณคือ classify intent ของข้อความลูกค้า

Intent ที่รองรับ: ${INTENTS.join(', ')}

${stateHint}

Context ปัจจุบัน: ${JSON.stringify(context)}

ตอบเป็น JSON เท่านั้น รูปแบบ:
{
  "intent": "<intent>",
  "entities": {
    "product_name": "<ชื่อสินค้าหรือ null>",
    "quantity": <จำนวนหรือ null>
  },
  "confidence": <0-1>
}`;
  }

  private getStateHint(state: string): string {
    switch (state) {
      case 'awaiting_quantity':
        return 'สถานะปัจจุบัน: รอจำนวนสินค้า — ถ้าผู้ใช้ตอบตัวเลข ให้ intent เป็น place_order';
      case 'awaiting_order_confirm':
        return 'สถานะปัจจุบัน: รอยืนยันออเดอร์ — ถ้าผู้ใช้ยืนยัน ให้ intent เป็น place_order';
      case 'awaiting_slip':
        return 'สถานะปัจจุบัน: รอสลิปโอนเงิน — ถ้าผู้ใช้ถามยอด ให้ intent เป็น payment_inquiry';
      default:
        return 'สถานะปัจจุบัน: idle';
    }
  }
}
