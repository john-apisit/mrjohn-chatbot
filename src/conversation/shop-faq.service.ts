import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type ShopFaqTopic =
  | 'shipping'
  | 'promo'
  | 'return'
  | 'invoice'
  | 'restock'
  | 'contact';

const FAQ_TOPIC_ALIASES: Record<string, ShopFaqTopic> = {
  shipping: 'shipping',
  จัดส่ง: 'shipping',
  ส่งของ: 'shipping',
  ค่าส่ง: 'shipping',
  promo: 'promo',
  โปร: 'promo',
  โปรโมชั่น: 'promo',
  ส่วนลด: 'promo',
  return: 'return',
  คืนสินค้า: 'return',
  เปลี่ยนสินค้า: 'return',
  invoice: 'invoice',
  ใบกำกับภาษี: 'invoice',
  บิล: 'invoice',
  restock: 'restock',
  ของหมด: 'restock',
  มาของใหม่: 'restock',
  contact: 'contact',
  ติดต่อ: 'contact',
  แอดมิน: 'contact',
};

@Injectable()
export class ShopFaqService {
  private readonly defaults: Record<ShopFaqTopic, string>;
  private readonly overrides: Partial<Record<ShopFaqTopic, string>>;

  constructor(private readonly config: ConfigService) {
    this.defaults = {
      shipping:
        '🚚 จัดส่งทั่วประเทศ ใช้เวลา 1–3 วันทำการหลังยืนยันการชำระเงิน ค่าจัดส่งคิดตามจำนวนและพื้นที่ (แจ้งยอดรวมก่อนส่งของ)',
      promo:
        '🎁 มีส่วนลดตามจำนวนสั่งซื้อ (ราคา tier) โปรโมชั่นพิเศษจะประกาศในหน้าเพจเป็นครั้งคราว',
      return:
        '🔄 รับเปลี่ยน/คืนสินค้าที่มีตำหนิจากการผลิตภายใน 7 วันหลังได้รับของ กรุณาแจ้งแอดมินพร้อมรูปภาพ',
      invoice:
        '🧾 ออกใบกำกับภาษีได้ กรุณาแจ้งชื่อบริษัท เลขประจำตัวผู้เสียภาษี และที่อยู่ก่อนชำระเงิน',
      restock:
        '📦 หากสินค้าหมด ทีมงานจะแจ้งกลับและประมาณวันเข้าสต็อกให้ทราบ สามารถจองไว้ก่อนได้โดยติดต่อแอดมิน',
      contact:
        '💬 หากต้องการความช่วยเหลือเพิ่มเติม พิมพ์คำถามมาได้เลย ระบบจะประสานงานแอดมินให้เร็วที่สุดค่ะ',
    };

    this.overrides = {
      shipping: this.config.get<string>('SHOP_FAQ_SHIPPING'),
      promo: this.config.get<string>('SHOP_FAQ_PROMO'),
      return: this.config.get<string>('SHOP_FAQ_RETURN'),
      invoice: this.config.get<string>('SHOP_FAQ_INVOICE'),
      restock: this.config.get<string>('SHOP_FAQ_RESTOCK'),
      contact: this.config.get<string>('SHOP_FAQ_CONTACT'),
    };
  }

  resolveTopic(raw?: string | null): ShopFaqTopic | null {
    if (!raw?.trim()) {
      return null;
    }
    const key = raw.trim().toLowerCase();
    return FAQ_TOPIC_ALIASES[key] ?? FAQ_TOPIC_ALIASES[raw.trim()] ?? null;
  }

  getAnswer(topic: ShopFaqTopic): string {
    return this.overrides[topic] ?? this.defaults[topic];
  }

  getMenuMessage(): string {
    return `📋 ข้อมูลร้านค้า — เลือกหัวข้อที่สนใจค่ะ:

🚚 จัดส่งและค่าส่ง
🎁 โปรโมชั่น / ส่วนลด
🔄 คืน/เปลี่ยนสินค้า
🧾 ใบกำกับภาษี
📦 สินค้าหมด / รอของเข้า
💬 ติดต่อแอดมิน`;
  }
}
