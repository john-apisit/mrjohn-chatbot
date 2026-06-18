import { QuickReply } from '../messenger/messenger.types';

export const PRODUCT_QUICK_REPLIES: QuickReply[] = [
  { content_type: 'text', title: 'ดูสินค้า', payload: 'VIEW_PRODUCTS' },
  { content_type: 'text', title: 'สินค้าแนะนำ', payload: 'VIEW_FEATURED' },
  { content_type: 'text', title: 'คำนวณราคา', payload: 'PRICE_QUOTE' },
  { content_type: 'text', title: 'ข้อมูลร้าน', payload: 'SHOP_FAQ' },
];

export const PRODUCT_DETAIL_BUTTONS = [
  { title: 'สั่งซื้อ', payload: 'ORDER_PRODUCT_PLACEHOLDER' },
  { title: 'คำนวณราคา', payload: 'PRICE_QUOTE' },
  { title: 'เช็คสต็อก', payload: 'CHECK_STOCK' },
  { title: 'ดูสินค้าอื่น', payload: 'VIEW_OTHER_PRODUCTS' },
] as const;

export const CART_CONFIRM_BUTTONS = [
  { title: 'ยืนยันออเดอร์', payload: 'CONFIRM_ORDER' },
  { title: 'เพิ่มสินค้าอื่น', payload: 'ADD_MORE_PRODUCTS' },
  { title: 'เปลี่ยนจำนวน', payload: 'CHANGE_QUANTITY' },
  { title: 'ล้างตะกร้า', payload: 'CLEAR_CART' },
] as const;

export const SHOP_FAQ_QUICK_REPLIES: QuickReply[] = [
  { content_type: 'text', title: '🚚 จัดส่ง', payload: 'SHOP_FAQ:shipping' },
  { content_type: 'text', title: '🎁 โปร', payload: 'SHOP_FAQ:promo' },
  { content_type: 'text', title: '🔄 คืนสินค้า', payload: 'SHOP_FAQ:return' },
  { content_type: 'text', title: '🧾 ใบกำกับ', payload: 'SHOP_FAQ:invoice' },
  { content_type: 'text', title: '📦 รอของเข้า', payload: 'SHOP_FAQ:restock' },
];
