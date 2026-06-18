import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ProductService } from '../product/product.service';

export interface ProductAnswerInput {
  question: string;
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
  contextProductId?: string;
}

export interface ProductAnswerResult {
  answered: boolean;
  productId?: string;
  message: string;
}

interface ProductAnswerPayload {
  can_answer: boolean;
  product_id?: string | null;
  message?: string;
}

@Injectable()
export class ProductAnswerService {
  private readonly logger = new Logger(ProductAnswerService.name);
  private readonly openai: OpenAI;
  private readonly shopName: string;

  constructor(
    private readonly config: ConfigService,
    private readonly productService: ProductService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.config.getOrThrow<string>('OPENAI_API_KEY'),
    });
    this.shopName =
      this.config.get<string>('SHOP_ACCOUNT_NAME') ?? 'ร้านของเรา';
  }

  async answerQuestion(
    input: ProductAnswerInput,
  ): Promise<ProductAnswerResult> {
    try {
      const products = await this.productService.listAllProducts();
      if (!products.length) {
        return { answered: false, message: '' };
      }

      const catalog = products.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description ?? '',
        stock_qty: p.stock_qty,
      }));

      const contextHint = input.contextProductId
        ? `\nสินค้าที่ลูกค้ากำลังสนใจจากบริบท (id): ${input.contextProductId}`
        : '';

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `คุณเป็นผู้ช่วยขายของร้าน "${this.shopName}" ตอบคำถามลูกค้าใน Facebook Messenger

Catalog สินค้าทั้งหมด:
${JSON.stringify(catalog, null, 2)}${contextHint}

กฎ:
- ตอบเป็นภาษาไทย สุภาพ ใช้ "ค่ะ"
- ใช้เฉพาะข้อมูลจาก catalog (ชื่อ name, รายละเอียด description, สต็อก stock_qty) ห้ามแต่งข้อมูล
- ค้นหาสินค้าที่เกี่ยวข้องจากชื่อและ description
- ถ้าคำถามเกี่ยวกับสินค้า (เช่น สี ขนาด ราคา รายละเอียด มีอะไรบ้าง) ให้ can_answer เป็น true
- ถ้าไม่พบข้อมูลใน catalog ให้ can_answer เป็น true และ message บอกว่าไม่มีข้อมูลนี้
- ถ้าคำถามไม่เกี่ยวกับสินค้าเลย (เช่น ทักทาย ถามออเดอร์ ชำระเงิน) ให้ can_answer เป็น false
- ถ้าตอบได้และระบุสินค้าได้ชัด ให้ใส่ product_id เป็น id จาก catalog

ตอบเป็น JSON เท่านั้น:
{
  "can_answer": true/false,
  "product_id": "<uuid หรือ null>",
  "message": "<ข้อความตอบลูกค้า>"
}`,
          },
          ...input.recentMessages.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
          { role: 'user', content: input.question },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return { answered: false, message: '' };
      }

      const parsed = JSON.parse(content) as ProductAnswerPayload;
      if (!parsed.can_answer || !parsed.message?.trim()) {
        return { answered: false, message: '' };
      }

      const productId =
        parsed.product_id &&
        catalog.some((p) => p.id === parsed.product_id)
          ? parsed.product_id
          : undefined;

      return {
        answered: true,
        productId,
        message: parsed.message.trim(),
      };
    } catch (err) {
      this.logger.error('Product answer failed', err);
      return { answered: false, message: '' };
    }
  }
}
