import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CartItem, ConversationContext, Intent } from '../common/types/domain.types';
import { MessengerService } from '../messenger/messenger.service';
import { FacebookMessagingEvent } from '../messenger/messenger.types';
import { OrderService } from '../order/order.service';
import { ProductService } from '../product/product.service';
import { ProductRow } from '../product/product.types';
import { SlipService } from '../slip/slip.service';
import { ConversationRepository } from './conversation.repository';
import {
  buildPriceQuoteButtons,
  buildProductCardButtons,
  buildProductDetailButtons,
  CART_CONFIRM_BUTTONS,
  GREETING_MENU_BUTTONS,
  PRODUCT_MENU_BUTTONS,
  PRODUCT_SECONDARY_BUTTONS,
  SHOP_FAQ_MENU_BUTTONS,
} from './conversation.quick-replies';
import { IntentClassifier } from './intent/intent.classifier';
import { ProductAnswerService } from './product-answer.service';
import { ShopFaqService } from './shop-faq.service';
import { POSTBACK_INTENT_MAP, isProductBrowseTrigger } from './intent/intent.types';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);
  private readonly recentMessages = new Map<
    string,
    Array<{ role: 'user' | 'assistant'; content: string }>
  >();
  private readonly rateLimitMap = new Map<
    string,
    { count: number; resetAt: number }
  >();
  private readonly shopBankAccount: string;
  private readonly shopBankName: string;
  private readonly shopAccountName: string;

  constructor(
    private readonly conversationRepo: ConversationRepository,
    private readonly intentClassifier: IntentClassifier,
    private readonly productAnswerService: ProductAnswerService,
    private readonly shopFaqService: ShopFaqService,
    private readonly productService: ProductService,
    private readonly orderService: OrderService,
    private readonly slipService: SlipService,
    private readonly messenger: MessengerService,
    private readonly config: ConfigService,
  ) {
    this.shopBankAccount = this.config.getOrThrow<string>('SHOP_BANK_ACCOUNT');
    this.shopBankName = this.config.getOrThrow<string>('SHOP_BANK_NAME');
    this.shopAccountName = this.config.getOrThrow<string>('SHOP_ACCOUNT_NAME');
  }

  async handleEvent(event: FacebookMessagingEvent): Promise<void> {
    const psid = event.sender.id;
    this.logger.log(
      `handleEvent start psid=${psid} ${this.describeIncomingEvent(event)}`,
    );

    if (!this.checkRateLimit(psid)) {
      this.logger.warn(`rate limit exceeded psid=${psid}`);
      await this.messenger.sendText(
        psid,
        'คุณส่งข้อความบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่ค่ะ',
      );
      return;
    }

    if (event.postback) {
      this.logger.log(
        `routing postback psid=${psid} payload=${event.postback.payload}`,
      );
      await this.handlePostback(psid, event.postback.payload);
      this.logger.log(`handleEvent done psid=${psid} handler=postback`);
      return;
    }

    if (event.message?.attachments?.some((a) => a.type === 'image')) {
      this.logger.log(`routing image psid=${psid}`);
      await this.handleImageAttachment(psid, event);
      this.logger.log(`handleEvent done psid=${psid} handler=image`);
      return;
    }

    if (event.message?.text) {
      const quickReplyPayload = event.message.quick_reply?.payload;
      if (quickReplyPayload) {
        this.logger.log(
          `routing quick_reply psid=${psid} payload=${quickReplyPayload} text="${this.previewText(event.message.text)}"`,
        );
        await this.handlePostback(psid, quickReplyPayload);
        this.logger.log(`handleEvent done psid=${psid} handler=quick_reply`);
        return;
      }

      this.logger.log(
        `routing text psid=${psid} text="${this.previewText(event.message.text)}"`,
      );
      await this.handleTextMessage(psid, event.message.text);
      this.logger.log(`handleEvent done psid=${psid} handler=text`);
      return;
    }

    this.logger.warn(
      `unhandled event psid=${psid} ${this.describeIncomingEvent(event)}`,
    );
  }

  private async handlePostback(psid: string, payload: string): Promise<void> {
    const conversation = await this.conversationRepo.getOrCreate(psid);
    this.logger.log(
      `handlePostback psid=${psid} payload=${payload} state=${conversation.state}`,
    );

    if (payload === 'CONFIRM_ORDER') {
      await this.confirmPendingOrder(psid, conversation.context);
      return;
    }
    if (payload === 'CHANGE_QUANTITY') {
      await this.handleChangeQuantity(psid, conversation.context);
      return;
    }
    if (payload === 'ADD_MORE_PRODUCTS') {
      await this.handleAddMoreProducts(psid, conversation.context);
      return;
    }
    if (payload === 'CLEAR_CART' || payload === 'CANCEL_ORDER') {
      await this.handleCancelOrder(psid);
      return;
    }
    if (payload.startsWith('CHECK_STOCK:')) {
      const productId = payload.replace('CHECK_STOCK:', '');
      await this.handleStockCheckForProduct(psid, productId);
      return;
    }
    if (payload.startsWith('PRICE_QUOTE:')) {
      const productId = payload.replace('PRICE_QUOTE:', '');
      await this.startPriceQuoteForProduct(psid, productId);
      return;
    }
    if (payload === 'PRICE_QUOTE') {
      await this.startPriceQuoteFlow(psid, conversation.context);
      return;
    }
    if (payload === 'CHECK_STOCK') {
      await this.handleStockCheckFromContext(psid, conversation.context);
      return;
    }
    if (payload.startsWith('SHOP_FAQ:')) {
      await this.handleShopFaq(
        psid,
        payload.replace('SHOP_FAQ:', ''),
      );
      return;
    }
    if (payload.startsWith('ORDER_PRODUCT:')) {
      const productId = payload.replace('ORDER_PRODUCT:', '');
      await this.startOrderFlow(psid, productId);
      return;
    }

    const mappedIntent = POSTBACK_INTENT_MAP[payload];
    this.logger.log(
      `postback mapped psid=${psid} payload=${payload} intent=${mappedIntent ?? 'none'}`,
    );
    if (mappedIntent === 'greeting') {
      await this.handleGreeting(psid);
    } else if (mappedIntent === 'product_inquiry') {
      if (payload === 'VIEW_FEATURED') {
        await this.handleFeaturedProducts(psid);
      } else if (payload === 'ADD_MORE_PRODUCTS') {
        await this.handleAddMoreProducts(psid, conversation.context);
      } else {
        await this.handleProductInquiry(psid);
      }
    } else if (mappedIntent === 'order_status') {
      await this.handleOrderStatus(psid);
    } else if (mappedIntent === 'shop_faq') {
      await this.handleShopFaq(psid, '');
    } else if (mappedIntent === 'price_quote') {
      await this.startPriceQuoteFlow(psid, conversation.context);
    } else if (mappedIntent === 'stock_check') {
      await this.handleStockCheckFromContext(psid, conversation.context);
    } else if (mappedIntent === 'cancel_order') {
      await this.handleCancelOrder(psid);
    }
  }

  private async handleTextMessage(psid: string, text: string): Promise<void> {
    const conversation = await this.conversationRepo.getOrCreate(psid);
    this.logger.log(
      `handleTextMessage psid=${psid} state=${conversation.state} text="${this.previewText(text)}" context=${JSON.stringify(conversation.context)}`,
    );
    this.addRecentMessage(psid, 'user', text);

    let intent: Intent;
    let entities: {
      product_name?: string | null;
      quantity?: number | null;
      faq_topic?: string | null;
    };

    if (conversation.state === 'awaiting_quantity') {
      const qty = this.parseQuantity(text);
      if (qty !== null) {
        intent = 'place_order';
        entities = { quantity: qty };
        this.logger.log(
          `parsed quantity psid=${psid} quantity=${qty} intent=place_order`,
        );
      } else {
        const result = await this.intentClassifier.classify({
          text,
          state: conversation.state,
          context: conversation.context as Record<string, unknown>,
          recentMessages: this.getRecentMessages(psid),
        });
        intent = result.intent;
        entities = result.entities;
        this.logger.log(
          `classified psid=${psid} source=awaiting_quantity intent=${intent} entities=${JSON.stringify(entities)}`,
        );
      }
    } else if (conversation.state === 'awaiting_price_quote_qty') {
      const qty = this.parseQuantity(text);
      if (qty !== null) {
        intent = 'price_quote';
        entities = { quantity: qty };
        this.logger.log(
          `parsed quantity psid=${psid} quantity=${qty} intent=price_quote`,
        );
      } else {
        const result = await this.intentClassifier.classify({
          text,
          state: conversation.state,
          context: conversation.context as Record<string, unknown>,
          recentMessages: this.getRecentMessages(psid),
        });
        intent = result.intent;
        entities = result.entities;
        this.logger.log(
          `classified psid=${psid} source=awaiting_price_quote_qty intent=${intent} entities=${JSON.stringify(entities)}`,
        );
      }
    } else {
      const result = await this.intentClassifier.classify({
        text,
        state: conversation.state,
        context: conversation.context as Record<string, unknown>,
        recentMessages: this.getRecentMessages(psid),
      });
      intent = result.intent;
      entities = result.entities;
      this.logger.log(
        `classified psid=${psid} source=default intent=${intent} entities=${JSON.stringify(entities)}`,
      );
    }

    await this.routeIntent(psid, intent, entities, text);
  }

  private async handleImageAttachment(
    psid: string,
    event: FacebookMessagingEvent,
  ): Promise<void> {
    const conversation = await this.conversationRepo.getOrCreate(psid);
    this.logger.log(
      `handleImageAttachment psid=${psid} state=${conversation.state} pendingOrderId=${conversation.context.pending_order_id ?? 'none'}`,
    );

    if (conversation.state !== 'awaiting_slip') {
      await this.messenger.sendText(
        psid,
        'ได้รับรูปภาพแล้วค่ะ หากต้องการชำระเงิน กรุณาสั่งซื้อสินค้าก่อนนะคะ',
      );
      return;
    }

    const imageAttachment = event.message?.attachments?.find(
      (a) => a.type === 'image',
    );
    const imageUrl = imageAttachment?.payload?.url;
    if (!imageUrl) {
      await this.messenger.sendText(psid, 'ไม่สามารถอ่านรูปได้ กรุณาส่งใหม่ค่ะ');
      return;
    }

    const orderId = conversation.context.pending_order_id;
    if (!orderId) {
      await this.messenger.sendText(
        psid,
        'ไม่พบออเดอร์ที่รอชำระ กรุณาสั่งซื้อใหม่ค่ะ',
      );
      return;
    }

    const order = await this.orderService.getOrderById(orderId);
    if (!order || !order.total_amount) {
      await this.messenger.sendText(psid, 'ไม่พบออเดอร์ กรุณาสั่งซื้อใหม่ค่ะ');
      return;
    }

    await this.messenger.sendText(psid, 'ระบบกำลังตรวจสอบสลิป กรุณารอสักครู่นะคะ...');
    this.logger.log(
      `slip verification start psid=${psid} orderId=${orderId} amount=${order.total_amount}`,
    );

    try {
      const buffer = await this.slipService.downloadImageFromUrl(
        imageUrl,
        this.messenger.getPageAccessToken(),
      );
      const result = await this.slipService.verifySlipFromImage(
        buffer,
        Number(order.total_amount),
      );
      this.logger.log(
        `slip verification result psid=${psid} orderId=${orderId} ok=${result.ok} code=${result.ok ? 'success' : result.code}`,
      );

      if (!result.ok) {
        const userMsg = this.slipService.getUserMessageForError(
          result.code,
          result.message,
        );
        await this.messenger.sendText(psid, userMsg);
        await this.orderService.notifyAdmin('slip_error', orderId, {
          psid,
          code: result.code,
          message: result.message,
        });
        if (this.slipService.shouldEscalate(result.code)) {
          await this.messenger.notifyAdmin(
            `Slip error order ${order.order_number}: ${result.message}`,
          );
        }
        return;
      }

      const paidOrder = await this.orderService.markPaid(
        orderId,
        result.slipUrl,
        result.transRef,
      );
      if (!paidOrder) {
        await this.messenger.sendText(
          psid,
          'เกิดข้อผิดพลาดในการอัปเดตออเดอร์ กรุณาติดต่อแอดมินค่ะ',
        );
        return;
      }

      await this.conversationRepo.updateState(
        psid,
        'awaiting_slip',
        'idle',
        {},
      );

      await this.messenger.sendText(
        psid,
        `✅ ตรวจสอบสลิปเรียบร้อยแล้วค่ะ\n\n📋 ออเดอร์: ${paidOrder.order_number}\n💵 ยอด: ${result.amount.toLocaleString()} บาท\n\nขอบคุณที่สั่งซื้อนะคะ เราจะดำเนินการจัดส่งให้เร็วที่สุด`,
      );

      await this.orderService.notifyAdmin('payment_received', orderId, {
        psid,
        transRef: result.transRef,
        amount: result.amount,
      });
      await this.messenger.notifyAdmin(
        `Payment received: ${paidOrder.order_number} — ${result.amount} THB`,
      );
      this.logger.log(
        `slip verification success psid=${psid} orderNumber=${paidOrder.order_number} amount=${result.amount}`,
      );
    } catch (err) {
      this.logger.error(
        `slip verification failed psid=${psid} orderId=${orderId}`,
        err instanceof Error ? err.stack : err,
      );
      await this.messenger.sendText(
        psid,
        'ไม่สามารถตรวจสลิปได้ กรุณาลองส่งใหม่หรือติดต่อแอดมินค่ะ',
      );
    }
  }

  private async routeIntent(
    psid: string,
    intent: Intent,
    entities: {
      product_name?: string | null;
      quantity?: number | null;
      faq_topic?: string | null;
    },
    text: string,
  ): Promise<void> {
    this.logger.log(
      `routeIntent psid=${psid} intent=${intent} entities=${JSON.stringify(entities)}`,
    );
    switch (intent) {
      case 'greeting':
        await this.handleGreeting(psid);
        break;
      case 'product_inquiry': {
        const query = entities.product_name ?? text;
        if (this.isFeaturedBrowseTrigger(query)) {
          await this.handleFeaturedProducts(psid);
        } else if (isProductBrowseTrigger(query)) {
          await this.handleProductInquiry(psid);
        } else {
          const products = await this.productService.searchProducts(query);
          if (products.length) {
            await this.handleProductInquiry(psid, query);
          } else {
            const answered = await this.tryAnswerProductQuestion(psid, text);
            if (!answered) {
              await this.handleProductInquiry(psid, query);
            }
          }
        }
        break;
      }
      case 'stock_check':
        await this.handleStockCheck(psid, entities.product_name ?? text);
        break;
      case 'price_quote':
        await this.handlePriceQuote(psid, entities, text);
        break;
      case 'place_order':
        await this.handlePlaceOrder(psid, entities);
        break;
      case 'payment_inquiry':
        await this.handlePaymentInquiry(psid);
        break;
      case 'order_status':
        await this.handleOrderStatus(psid);
        break;
      case 'shop_faq':
        await this.handleShopFaq(psid, entities.faq_topic ?? text);
        break;
      case 'cancel_order':
        await this.handleCancelOrder(psid);
        break;
      case 'fallback':
      default:
        await this.handleFallback(psid, text);
        break;
    }
  }

  private async handleGreeting(psid: string): Promise<void> {
    const reply =
      'สวัสดีค่ะ ยินดีต้อนรับ 🙏\n\nมีอะไรให้ช่วยไหมคะ?';
    this.addRecentMessage(psid, 'assistant', reply);
    await this.messenger.sendVerticalButtons(psid, reply, GREETING_MENU_BUTTONS);
  }

  private async handleProductInquiry(
    psid: string,
    query?: string,
  ): Promise<void> {
    const products = query
      ? await this.productService.searchProducts(query)
      : await this.productService.listProducts();
    if (!products.length) {
      if (query) {
        const answered = await this.tryAnswerProductQuestion(psid, query);
        if (answered) {
          return;
        }
      }
      const reply = query
        ? `ไม่พบสินค้า "${query}" กรุณาลองค้นหาด้วยชื่ออื่นค่ะ`
        : 'ยังไม่มีสินค้าในระบบค่ะ';
      this.addRecentMessage(psid, 'assistant', reply);
      await this.messenger.sendText(psid, reply);
      return;
    }

    if (products.length === 1) {
      const full = await this.productService.getProductById(products[0].id);
      if (!full) {
        await this.messenger.sendText(psid, 'ไม่พบข้อมูลสินค้าค่ะ');
        return;
      }
      await this.rememberLastProduct(psid, full.id);
      const msg = this.productService.formatProductMessage(full);
      this.addRecentMessage(psid, 'assistant', msg);
      await this.messenger.sendVerticalButtons(
        psid,
        msg,
        buildProductDetailButtons(full.id),
      );
      // await this.messenger.sendVerticalButtons(
      //   psid,
      //   'เลือกดำเนินการต่อได้เลยค่ะ',
      //   PRODUCT_SECONDARY_BUTTONS,
      // );
      return;
    }

    await this.messenger.sendGenericTemplate(
      psid,
      await Promise.all(
        products.slice(0, 5).map(async (p) => {
          return {
            title: p.name,
            subtitle: `คงเหลือ ${p.stock_qty.toLocaleString()} ชิ้น`,
            image_url: p.image_url ?? undefined,
            buttons: buildProductCardButtons(p.id),
          };
        }),
      ),
    );
  }

  private async handleStockCheck(psid: string, query: string): Promise<void> {
    const products = await this.productService.searchProducts(query);
    if (!products.length) {
      await this.messenger.sendText(
        psid,
        `ไม่พบสินค้า "${query}" กรุณาลองค้นหาใหม่ค่ะ`,
      );
      return;
    }
    const product = products[0];
    const reply = `📦 ${product.name}\n📊 คงเหลือ: ${product.stock_qty.toLocaleString()} ชิ้น`;
    this.addRecentMessage(psid, 'assistant', reply);
    await this.messenger.sendText(psid, reply);
  }

  private async startOrderFlow(psid: string, productId: string): Promise<void> {
    this.logger.log(
      `startOrderFlow psid=${psid} productId=${productId}`,
    );
    const product = await this.productService.getProductById(productId);
    if (!product) {
      await this.messenger.sendText(psid, 'ไม่พบสินค้าค่ะ');
      return;
    }

    await this.conversationRepo.getOrCreate(psid);
    await this.conversationRepo.updateContext(
      psid,
      { pending_product_id: productId, last_product_id: productId },
      'awaiting_quantity',
    );

    const msg = `${this.productService.formatProductMessage(product)}\n\nกรุณาระบุจำนวนที่ต้องการสั่งค่ะ`;
    this.addRecentMessage(psid, 'assistant', msg);
    await this.messenger.sendText(psid, msg);
  }

  private async handlePlaceOrder(
    psid: string,
    entities: {
      product_name?: string | null;
      quantity?: number | null;
    },
  ): Promise<void> {
    const conversation = await this.conversationRepo.getOrCreate(psid);
    this.logger.log(
      `handlePlaceOrder psid=${psid} state=${conversation.state} entities=${JSON.stringify(entities)} context=${JSON.stringify(conversation.context)}`,
    );

    if (conversation.state === 'awaiting_order_confirm') {
      await this.confirmPendingOrder(psid, conversation.context);
      return;
    }

    const productId = conversation.context.pending_product_id;
    const quantity = entities.quantity ?? conversation.context.pending_quantity;

    if (!productId) {
      if (entities.product_name) {
        const products = await this.productService.searchProducts(
          entities.product_name,
        );
        if (products.length === 1) {
          await this.startOrderFlow(psid, products[0].id);
          if (entities.quantity) {
            await this.handlePlaceOrder(psid, {
              quantity: entities.quantity,
            });
          }
          return;
        }
      }
      await this.messenger.sendText(
        psid,
        'กรุณาเลือกสินค้าก่อนสั่งซื้อค่ะ พิมพ์ชื่อสินค้าเพื่อค้นหา',
      );
      return;
    }

    if (!quantity) {
      if (conversation.state !== 'awaiting_quantity') {
        await this.conversationRepo.updateState(
          psid,
          conversation.state,
          'awaiting_quantity',
          conversation.context,
        );
      }
      await this.messenger.sendText(psid, 'กรุณาระบุจำนวนที่ต้องการสั่งค่ะ');
      return;
    }

    const inStock = await this.productService.checkStock(productId, quantity);
    if (!inStock) {
      this.logger.warn(
        `out of stock psid=${psid} productId=${productId} quantity=${quantity}`,
      );
      await this.messenger.sendText(
        psid,
        'ขออภัยค่ะ สินค้าไม่เพียงพอ กรุณาลดจำนวนหรือติดต่อแอดมิน',
      );
      return;
    }

    let resolved;
    try {
      resolved = await this.productService.resolvePrice(productId, quantity);
    } catch {
      await this.messenger.sendText(
        psid,
        'จำนวนที่สั่งไม่ถึงขั้นต่ำ กรุณาระบุจำนวนใหม่ค่ะ',
      );
      return;
    }

    const cartItem: CartItem = {
      product_id: productId,
      name: resolved.product.name,
      qty: quantity,
      unit_price: resolved.unit_price,
      min_qty_tier: resolved.min_qty,
      line_total: resolved.line_total,
    };

    const existingCart = conversation.context.cart_items ?? [];
    const cartItems = [
      ...existingCart.filter((item) => item.product_id !== productId),
      cartItem,
    ];
    const totalAmount = cartItems.reduce(
      (sum, item) => sum + item.line_total,
      0,
    );

    let orderId = conversation.context.pending_order_id;
    if (orderId) {
      const updated = await this.orderService.updateDraftOrder(
        orderId,
        cartItems,
        totalAmount,
      );
      if (!updated) {
        const order = await this.orderService.createDraftOrder(
          psid,
          cartItems,
          totalAmount,
        );
        orderId = order.id;
      }
    } else {
      const order = await this.orderService.createDraftOrder(
        psid,
        cartItems,
        totalAmount,
      );
      orderId = order.id;
    }

    const summary = this.productService.formatCartSummary(cartItems);

    await this.conversationRepo.updateContext(
      psid,
      {
        ...conversation.context,
        cart_items: cartItems,
        pending_product_id: productId,
        pending_quantity: quantity,
        pending_order_id: orderId,
        last_product_id: productId,
      },
      'awaiting_order_confirm',
    );

    this.logger.log(
      `draft order updated psid=${psid} orderId=${orderId} items=${cartItems.length} total=${totalAmount}`,
    );
    this.addRecentMessage(psid, 'assistant', summary);
    await this.messenger.sendVerticalButtons(psid, summary, CART_CONFIRM_BUTTONS);
  }

  private async confirmPendingOrder(
    psid: string,
    context: ConversationContext,
  ): Promise<void> {
    const orderId = context.pending_order_id;
    this.logger.log(
      `confirmPendingOrder psid=${psid} orderId=${orderId ?? 'none'} items=${context.cart_items?.length ?? 0}`,
    );

    if (!orderId) {
      await this.messenger.sendText(psid, 'ไม่พบออเดอร์ กรุณาสั่งซื้อใหม่ค่ะ');
      return;
    }

    const order = await this.orderService.getOrderById(orderId);
    if (!order?.items.length) {
      await this.messenger.sendText(psid, 'ไม่พบออเดอร์ กรุณาสั่งซื้อใหม่ค่ะ');
      return;
    }

    for (const item of order.items) {
      const inStock = await this.productService.checkStock(
        item.product_id,
        item.qty,
      );
      if (!inStock) {
        await this.messenger.sendText(
          psid,
          `ขออภัยค่ะ สินค้า "${item.name}" ไม่เพียงพอ กรุณาปรับจำนวนหรือลบรายการออก`,
        );
        return;
      }
    }

    const reservedItems: Array<{ product_id: string; qty: number }> = [];
    for (const item of order.items) {
      const reserved = await this.productService.reserveStock(
        item.product_id,
        item.qty,
      );
      if (!reserved) {
        for (const released of reservedItems) {
          await this.productService.releaseStock(
            released.product_id,
            released.qty,
          );
        }
        await this.messenger.sendText(
          psid,
          'ขออภัยค่ะ สินค้าไม่เพียงพอ กรุณาลองใหม่',
        );
        return;
      }
      reservedItems.push({
        product_id: item.product_id,
        qty: item.qty,
      });
    }

    const confirmed = await this.orderService.confirmOrder(orderId);
    if (!confirmed) {
      for (const item of reservedItems) {
        await this.productService.releaseStock(item.product_id, item.qty);
      }
      await this.messenger.sendText(
        psid,
        'เกิดข้อผิดพลาด กรุณาลองใหม่ค่ะ',
      );
      return;
    }

    await this.conversationRepo.updateState(
      psid,
      'awaiting_order_confirm',
      'awaiting_slip',
      {
        pending_order_id: orderId,
        cart_items: context.cart_items,
        last_product_id: context.last_product_id,
      },
    );

    const paymentMsg = `✅ ยืนยันออเดอร์ ${confirmed.order_number} แล้วค่ะ

💵 ยอดชำระ: ${Number(confirmed.total_amount).toLocaleString()} บาท

🏦 โอนเข้าบัญชี:
${this.shopBankName}
${this.shopAccountName}
${this.shopBankAccount}

กรุณาโอนเงินแล้วส่งรูปสลิปมาในแชทนี้ค่ะ`;

    this.addRecentMessage(psid, 'assistant', paymentMsg);
    await this.messenger.sendText(psid, paymentMsg);

    await this.orderService.notifyAdmin('new_order', orderId, {
      psid,
      orderNumber: confirmed.order_number,
      total: confirmed.total_amount,
    });
    await this.messenger.notifyAdmin(
      `New order: ${confirmed.order_number} — ${confirmed.total_amount} THB`,
    );
    this.logger.log(
      `order confirmed psid=${psid} orderNumber=${confirmed.order_number} total=${confirmed.total_amount}`,
    );
  }

  private async handlePaymentInquiry(psid: string): Promise<void> {
    const order = await this.orderService.getPendingPaymentOrder(psid);
    if (!order) {
      await this.messenger.sendText(
        psid,
        'ไม่พบออเดอร์ที่รอชำระค่ะ กรุณาสั่งซื้อก่อน',
      );
      return;
    }

    const msg = `💵 ยอดชำระออเดอร์ ${order.order_number}: ${Number(order.total_amount).toLocaleString()} บาท

🏦 ${this.shopBankName} | ${this.shopAccountName}
${this.shopBankAccount}`;
    await this.messenger.sendText(psid, msg);
  }

  private async handleOrderStatus(psid: string): Promise<void> {
    const order = await this.orderService.getLatestOrderByPsid(psid);
    if (!order) {
      await this.messenger.sendText(psid, 'ยังไม่มีออเดอร์ในระบบค่ะ');
      return;
    }
    const msg = this.orderService.formatOrderStatus(order);
    this.addRecentMessage(psid, 'assistant', msg);
    await this.messenger.sendText(psid, msg);
  }

  private async handleFallback(psid: string, text: string): Promise<void> {
    const answered = await this.tryAnswerProductQuestion(psid, text);
    if (answered) {
      return;
    }

    const reply =
      'รับทราบค่ะ ระบบกำลังประสานงานเจ้าหน้าที่ แล้วจะตอบกลับให้เร็วที่สุดนะคะ';
    this.addRecentMessage(psid, 'assistant', reply);
    await this.messenger.sendText(psid, reply);
    await this.messenger.notifyAdmin(
      `Fallback intent from PSID ${psid}: "${text}"`,
    );
  }

  private async tryAnswerProductQuestion(
    psid: string,
    question: string,
  ): Promise<boolean> {
    const conversation = await this.conversationRepo.getOrCreate(psid);
    const contextProductId =
      conversation.context.last_product_id ??
      conversation.context.pending_product_id;

    const result = await this.productAnswerService.answerQuestion({
      question,
      recentMessages: this.getRecentMessages(psid),
      contextProductId,
    });

    if (!result.answered) {
      return false;
    }

    if (result.productIds.length) {
      const products = await this.productService.getProductsByIds(
        result.productIds,
      );
      if (products.length) {
        await this.sendProductList(psid, products, result.message);
        if (products.length === 1) {
          await this.rememberLastProduct(psid, products[0].id);
        }
        return true;
      }
    }

    this.addRecentMessage(psid, 'assistant', result.message);
    await this.messenger.sendText(psid, result.message);
    return true;
  }

  private async sendProductList(
    psid: string,
    products: ProductRow[],
    introMessage?: string,
  ): Promise<void> {
    if (introMessage) {
      this.addRecentMessage(psid, 'assistant', introMessage);
      await this.messenger.sendText(psid, introMessage);
    }

    const listSummary = products
      .map(
        (p, i) =>
          `${i + 1}. ${p.name}${p.description ? ` — ${p.description}` : ''} (คงเหลือ ${p.stock_qty.toLocaleString()} ชิ้น)`,
      )
      .join('\n');
    this.addRecentMessage(psid, 'assistant', listSummary);

    await this.messenger.sendGenericTemplate(
      psid,
      products.slice(0, 10).map((p) => ({
        title: p.name,
        subtitle: p.description
          ? `${p.description.slice(0, 80)} · คงเหลือ ${p.stock_qty.toLocaleString()} ชิ้น`
          : `คงเหลือ ${p.stock_qty.toLocaleString()} ชิ้น`,
        image_url: p.image_url ?? undefined,
        buttons: buildProductCardButtons(p.id),
      })),
    );
  }

  private async rememberLastProduct(
    psid: string,
    productId: string,
  ): Promise<void> {
    const conversation = await this.conversationRepo.getOrCreate(psid);
    await this.conversationRepo.updateContext(psid, {
      ...conversation.context,
      last_product_id: productId,
    });
  }

  private async handleFeaturedProducts(psid: string): Promise<void> {
    const products = await this.productService.listFeaturedProducts();
    if (!products.length) {
      await this.messenger.sendText(
        psid,
        'ยังไม่มีสินค้าแนะนำในขณะนี้ค่ะ ลองดูสินค้าทั้งหมดได้เลย',
      );
      await this.handleProductInquiry(psid);
      return;
    }

    await this.sendProductList(
      psid,
      products,
      '⭐ สินค้าแนะนำของร้านค่ะ',
    );
  }

  private async handlePriceQuote(
    psid: string,
    entities: {
      product_name?: string | null;
      quantity?: number | null;
    },
    text: string,
  ): Promise<void> {
    const conversation = await this.conversationRepo.getOrCreate(psid);
    const productId = await this.resolveProductId(
      psid,
      entities.product_name,
      conversation.context,
    );
    let quantity =
      entities.quantity ??
      (conversation.state === 'awaiting_price_quote_qty'
        ? this.parseQuantity(text)
        : null);

    if (!productId) {
      await this.messenger.sendText(
        psid,
        'กรุณาเลือกหรือพิมพ์ชื่อสินค้าก่อนคำนวณราคาค่ะ',
      );
      await this.handleProductInquiry(psid);
      return;
    }

    if (!quantity) {
      await this.conversationRepo.updateContext(
        psid,
        {
          ...conversation.context,
          price_quote_product_id: productId,
          last_product_id: productId,
        },
        'awaiting_price_quote_qty',
      );
      const product = await this.productService.getProductById(productId);
      await this.messenger.sendText(
        psid,
        `กรุณาระบุจำนวนที่ต้องการคำนวณราคาสำหรับ "${product?.name ?? 'สินค้านี้'}" ค่ะ`,
      );
      return;
    }

    await this.sendPriceQuote(psid, productId, quantity);
    if (conversation.state === 'awaiting_price_quote_qty') {
      await this.conversationRepo.updateState(
        psid,
        'awaiting_price_quote_qty',
        'idle',
        {
          ...conversation.context,
          price_quote_product_id: undefined,
          last_product_id: productId,
        },
      );
    } else {
      await this.rememberLastProduct(psid, productId);
    }
  }

  private async startPriceQuoteFlow(
    psid: string,
    context: ConversationContext,
  ): Promise<void> {
    const productId =
      context.last_product_id ??
      context.pending_product_id ??
      context.price_quote_product_id;

    if (!productId) {
      await this.messenger.sendText(
        psid,
        'กรุณาเลือกสินค้าก่อนคำนวณราคาค่ะ',
      );
      await this.handleProductInquiry(psid);
      return;
    }

    await this.conversationRepo.updateContext(
      psid,
      {
        ...context,
        price_quote_product_id: productId,
        last_product_id: productId,
      },
      'awaiting_price_quote_qty',
    );
    const product = await this.productService.getProductById(productId);
    await this.messenger.sendText(
      psid,
      `กรุณาระบุจำนวนที่ต้องการคำนวณราคาสำหรับ "${product?.name ?? 'สินค้านี้'}" ค่ะ`,
    );
  }

  private async sendPriceQuote(
    psid: string,
    productId: string,
    quantity: number,
  ): Promise<void> {
    let resolved;
    try {
      resolved = await this.productService.resolvePrice(productId, quantity);
    } catch {
      await this.messenger.sendText(
        psid,
        'จำนวนที่ระบุไม่ถึงขั้นต่ำ กรุณาระบุจำนวนใหม่ค่ะ',
      );
      return;
    }

    const inStock = await this.productService.checkStock(productId, quantity);
    const msg = this.productService.formatPriceQuote(
      resolved.product.name,
      quantity,
      resolved.unit_price,
      resolved.min_qty,
      resolved.line_total,
      inStock,
    );
    this.addRecentMessage(psid, 'assistant', msg);
    await this.messenger.sendVerticalButtons(
      psid,
      msg,
      buildPriceQuoteButtons(productId),
    );
  }

  private async handleShopFaq(
    psid: string,
    topicInput: string,
  ): Promise<void> {
    const topic = this.shopFaqService.resolveTopic(topicInput);
    if (!topic) {
      const menu = this.shopFaqService.getMenuMessage();
      this.addRecentMessage(psid, 'assistant', menu);
      await this.messenger.sendVerticalButtons(psid, menu, SHOP_FAQ_MENU_BUTTONS);
      return;
    }

    const answer = this.shopFaqService.getAnswer(topic);
    this.addRecentMessage(psid, 'assistant', answer);
    await this.messenger.sendText(psid, answer);
  }

  private async handleCancelOrder(psid: string): Promise<void> {
    const conversation = await this.conversationRepo.getOrCreate(psid);
    const orderId = conversation.context.pending_order_id;

    if (orderId) {
      const order = await this.orderService.getOrderById(orderId);
      if (order) {
        if (order.status === 'pending_payment') {
          for (const item of order.items) {
            await this.productService.releaseStock(item.product_id, item.qty);
          }
        }
        await this.orderService.cancelOrder(orderId);
      }
    }

    await this.conversationRepo.updateContext(psid, {}, 'idle');

    const reply = 'ยกเลิกออเดอร์และล้างตะกร้าเรียบร้อยแล้วค่ะ';
    this.addRecentMessage(psid, 'assistant', reply);
    await this.messenger.sendVerticalButtons(psid, reply, PRODUCT_MENU_BUTTONS);
  }

  private async handleAddMoreProducts(
    psid: string,
    context: ConversationContext,
  ): Promise<void> {
    await this.conversationRepo.updateContext(
      psid,
      {
        cart_items: context.cart_items,
        pending_order_id: context.pending_order_id,
        last_product_id: context.last_product_id,
        pending_product_id: undefined,
        pending_quantity: undefined,
      },
      'idle',
    );
    await this.messenger.sendText(
      psid,
      'เลือกสินค้าเพิ่มในตะกร้าได้เลยค่ะ',
    );
    await this.handleProductInquiry(psid);
  }

  private async handleChangeQuantity(
    psid: string,
    context: ConversationContext,
  ): Promise<void> {
    const productId =
      context.pending_product_id ??
      context.cart_items?.[context.cart_items.length - 1]?.product_id;

    if (!productId) {
      await this.messenger.sendText(psid, 'ไม่พบสินค้าในตะกร้า กรุณาเลือกสินค้าใหม่ค่ะ');
      return;
    }

    const cartItems =
      context.cart_items?.filter((item) => item.product_id !== productId) ?? [];

    if (context.pending_order_id) {
      if (cartItems.length) {
        const totalAmount = cartItems.reduce(
          (sum, item) => sum + item.line_total,
          0,
        );
        await this.orderService.updateDraftOrder(
          context.pending_order_id,
          cartItems,
          totalAmount,
        );
      } else {
        await this.orderService.cancelOrder(context.pending_order_id);
      }
    }

    await this.conversationRepo.updateContext(
      psid,
      {
        ...context,
        cart_items: cartItems,
        pending_product_id: productId,
        pending_quantity: undefined,
        pending_order_id: cartItems.length
          ? context.pending_order_id
          : undefined,
        last_product_id: productId,
      },
      'awaiting_quantity',
    );

    const product = await this.productService.getProductById(productId);
    if (!product) {
      await this.messenger.sendText(psid, 'ไม่พบสินค้าค่ะ');
      return;
    }

    const msg = `${this.productService.formatProductMessage(product)}\n\nกรุณาระบุจำนวนใหม่ค่ะ`;
    this.addRecentMessage(psid, 'assistant', msg);
    await this.messenger.sendText(psid, msg);
  }

  private async handleStockCheckForProduct(
    psid: string,
    productId: string,
  ): Promise<void> {
    const product = await this.productService.getProductById(productId);
    if (!product) {
      await this.messenger.sendText(psid, 'ไม่พบสินค้าค่ะ');
      return;
    }

    await this.rememberLastProduct(psid, productId);
    const reply = `📦 ${product.name}\n📊 คงเหลือ: ${product.stock_qty.toLocaleString()} ชิ้น`;
    this.addRecentMessage(psid, 'assistant', reply);
    await this.messenger.sendText(psid, reply);
  }

  private async startPriceQuoteForProduct(
    psid: string,
    productId: string,
  ): Promise<void> {
    const conversation = await this.conversationRepo.getOrCreate(psid);
    await this.conversationRepo.updateContext(
      psid,
      {
        ...conversation.context,
        price_quote_product_id: productId,
        last_product_id: productId,
      },
      'awaiting_price_quote_qty',
    );
    const product = await this.productService.getProductById(productId);
    await this.messenger.sendText(
      psid,
      `กรุณาระบุจำนวนที่ต้องการคำนวณราคาสำหรับ "${product?.name ?? 'สินค้านี้'}" ค่ะ`,
    );
  }

  private async handleStockCheckFromContext(
    psid: string,
    context: ConversationContext,
  ): Promise<void> {
    const productId =
      context.last_product_id ??
      context.pending_product_id ??
      context.price_quote_product_id;

    if (!productId) {
      await this.messenger.sendText(
        psid,
        'กรุณาเลือกสินค้าก่อนเช็คสต็อกค่ะ',
      );
      await this.handleProductInquiry(psid);
      return;
    }

    const product = await this.productService.getProductById(productId);
    if (!product) {
      await this.messenger.sendText(psid, 'ไม่พบสินค้าค่ะ');
      return;
    }

    const reply = `📦 ${product.name}\n📊 คงเหลือ: ${product.stock_qty.toLocaleString()} ชิ้น`;
    this.addRecentMessage(psid, 'assistant', reply);
    await this.messenger.sendText(psid, reply);
  }

  private async resolveProductId(
    psid: string,
    productName: string | null | undefined,
    context: ConversationContext,
  ): Promise<string | null> {
    if (productName) {
      const products = await this.productService.searchProducts(productName);
      if (products.length === 1) {
        return products[0].id;
      }
      if (products.length > 1) {
        await this.handleProductInquiry(psid, productName);
        return null;
      }
    }

    return (
      context.price_quote_product_id ??
      context.last_product_id ??
      context.pending_product_id ??
      null
    );
  }

  private isFeaturedBrowseTrigger(query: string): boolean {
    return ['VIEW_FEATURED', 'สินค้าแนะนำ', 'แนะนำหน่อย'].includes(
      query.trim(),
    );
  }

  private parseQuantity(text: string): number | null {
    const match = text.replace(/,/g, '').match(/\d+/);
    if (!match) return null;
    const qty = parseInt(match[0], 10);
    return qty > 0 ? qty : null;
  }

  private addRecentMessage(
    psid: string,
    role: 'user' | 'assistant',
    content: string,
  ): void {
    const messages = this.recentMessages.get(psid) ?? [];
    messages.push({ role, content });
    if (messages.length > 5) {
      messages.shift();
    }
    this.recentMessages.set(psid, messages);
  }

  private getRecentMessages(
    psid: string,
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    return this.recentMessages.get(psid) ?? [];
  }

  private checkRateLimit(psid: string): boolean {
    const now = Date.now();
    const entry = this.rateLimitMap.get(psid);

    if (!entry || now > entry.resetAt) {
      this.rateLimitMap.set(psid, {
        count: 1,
        resetAt: now + RATE_LIMIT_WINDOW_MS,
      });
      return true;
    }

    if (entry.count >= RATE_LIMIT_MAX) {
      this.logger.warn(
        `rate limit blocked psid=${psid} count=${entry.count} resetAt=${entry.resetAt}`,
      );
      return false;
    }

    entry.count++;
    return true;
  }

  private describeIncomingEvent(event: FacebookMessagingEvent): string {
    if (event.postback) {
      return `type=postback payload=${event.postback.payload}`;
    }
    if (event.message?.attachments?.some((a) => a.type === 'image')) {
      return `type=image mid=${event.message?.mid ?? 'none'}`;
    }
    if (event.message?.text) {
      const quickReply = event.message.quick_reply?.payload;
      return `type=text mid=${event.message?.mid ?? 'none'} text="${this.previewText(event.message.text)}" quick_reply=${quickReply ?? 'none'}`;
    }
    return `type=unknown timestamp=${event.timestamp ?? 'none'}`;
  }

  private previewText(text: string, maxLength = 80): string {
    return text.slice(0, maxLength).replace(/\s+/g, ' ');
  }
}
