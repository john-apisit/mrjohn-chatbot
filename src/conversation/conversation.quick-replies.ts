export interface MenuButton {
  title: string;
  payload: string;
}

/** ปุ่มหลัก — เรียงจากบนลงล่าง เน้น CTA ซื้อ/ดูสินค้าก่อน */
export const PRODUCT_MENU_BUTTONS: MenuButton[] = [
  { title: '🛍️ ดูสินค้า', payload: 'VIEW_PRODUCTS' },
  { title: '⭐ สินค้าแนะนำ', payload: 'VIEW_FEATURED' },
  { title: '💰 คำนวณราคา', payload: 'PRICE_QUOTE' },
  { title: '🏪 ข้อมูลร้าน', payload: 'SHOP_FAQ' },
];

export const GREETING_MENU_BUTTONS: MenuButton[] = [
  ...PRODUCT_MENU_BUTTONS,
  { title: '📋 เช็คออเดอร์', payload: 'CHECK_ORDER' },
];

export const PRODUCT_SECONDARY_BUTTONS: MenuButton[] = [
  { title: '🔍 ดูสินค้าอื่น', payload: 'VIEW_OTHER_PRODUCTS' },
  { title: '🏪 ข้อมูลร้าน', payload: 'SHOP_FAQ' },
];

export function buildProductCardButtons(productId: string): MenuButton[] {
  return [
    { title: '🛒 สั่งซื้อเลย', payload: `ORDER_PRODUCT:${productId}` },
    { title: '💰 คำนวณราคา', payload: `PRICE_QUOTE:${productId}` },
    { title: '📦 เช็คสต็อก', payload: `CHECK_STOCK:${productId}` },
  ];
}

export function buildProductDetailButtons(productId: string): MenuButton[] {
  return [
    { title: '🛒 สั่งซื้อเลย', payload: `ORDER_PRODUCT:${productId}` },
    { title: '💰 คำนวณราคา', payload: 'PRICE_QUOTE' },
    { title: '📦 เช็คสต็อก', payload: 'CHECK_STOCK' },
  ];
}

export function buildPriceQuoteButtons(productId: string): MenuButton[] {
  return [
    { title: '🛒 สั่งซื้อเลย', payload: `ORDER_PRODUCT:${productId}` },
    { title: '💰 คำนวณใหม่', payload: 'PRICE_QUOTE' },
    { title: '🔍 ดูสินค้าอื่น', payload: 'VIEW_OTHER_PRODUCTS' },
  ];
}

export const CART_CONFIRM_BUTTONS: MenuButton[] = [
  { title: '✅ ยืนยันออเดอร์', payload: 'CONFIRM_ORDER' },
  { title: '➕ เพิ่มสินค้า', payload: 'ADD_MORE_PRODUCTS' },
  { title: '✏️ เปลี่ยนจำนวน', payload: 'CHANGE_QUANTITY' },
  { title: '🗑️ ล้างตะกร้า', payload: 'CLEAR_CART' },
];

export const SHOP_FAQ_MENU_BUTTONS: MenuButton[] = [
  { title: '🚚 จัดส่ง', payload: 'SHOP_FAQ:shipping' },
  { title: '🎁 โปรโมชัน', payload: 'SHOP_FAQ:promo' },
  { title: '🔄 คืนสินค้า', payload: 'SHOP_FAQ:return' },
  { title: '🧾 ใบกำกับ', payload: 'SHOP_FAQ:invoice' },
  { title: '📦 รอของเข้า', payload: 'SHOP_FAQ:restock' },
];
