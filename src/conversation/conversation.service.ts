import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Intent } from '../common/types/domain.types';
import { MessengerService } from '../messenger/messenger.service';
import { FacebookMessagingEvent } from '../messenger/messenger.types';
import { OrderService } from '../order/order.service';
import { ProductService } from '../product/product.service';
import { SlipService } from '../slip/slip.service';
import { ConversationRepository } from './conversation.repository';
import { IntentClassifier } from './intent/intent.classifier';
import { ProductAnswerService } from './product-answer.service';
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
      await this.conversationRepo.updateState(
        psid,
        conversation.state,
        'awaiting_quantity',
        { ...conversation.context, pending_quantity: undefined },
      );
      await this.messenger.sendText(psid, 'กรุณาระบุจำนวนที่ต้องการสั่งค่ะ');
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
      await this.handleProductInquiry(psid);
    } else if (mappedIntent === 'order_status') {
      await this.handleOrderStatus(psid);
    }
  }

  private async handleTextMessage(psid: string, text: string): Promise<void> {
    const conversation = await this.conversationRepo.getOrCreate(psid);
    this.logger.log(
      `handleTextMessage psid=${psid} state=${conversation.state} text="${this.previewText(text)}" context=${JSON.stringify(conversation.context)}`,
    );
    this.addRecentMessage(psid, 'user', text);

    let intent: Intent;
    let entities: { product_name?: string | null; quantity?: number | null };

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
    entities: { product_name?: string | null; quantity?: number | null },
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
        if (isProductBrowseTrigger(query)) {
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
      case 'place_order':
        await this.handlePlaceOrder(psid, entities);
        break;
      case 'payment_inquiry':
        await this.handlePaymentInquiry(psid);
        break;
      case 'order_status':
        await this.handleOrderStatus(psid);
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
    await this.messenger.sendQuickReplies(psid, reply, [
      { content_type: 'text', title: 'ดูสินค้า', payload: 'VIEW_PRODUCTS' },
      { content_type: 'text', title: 'เช็คออเดอร์', payload: 'CHECK_ORDER' },
    ]);
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
      await this.messenger.sendButtonTemplate(psid, msg, [
        { title: 'สั่งซื้อ', payload: `ORDER_PRODUCT:${full.id}` },
        { title: 'ดูสินค้าอื่น', payload: 'VIEW_OTHER_PRODUCTS' },
      ]);
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
            buttons: [
              {
                title: 'สั่งซื้อ',
                payload: `ORDER_PRODUCT:${p.id}`,
              },
            ],
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
    entities: { product_name?: string | null; quantity?: number | null },
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
      await this.conversationRepo.updateState(
        psid,
        conversation.state,
        'awaiting_quantity',
        conversation.context,
      );
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

    const summary = this.productService.formatOrderSummary(
      resolved.product.name,
      quantity,
      resolved.unit_price,
      resolved.min_qty,
      resolved.line_total,
    );

    const order = await this.orderService.createDraftOrder(
      psid,
      [
        {
          product_id: productId,
          name: resolved.product.name,
          qty: quantity,
          unit_price: resolved.unit_price,
          min_qty_tier: resolved.min_qty,
          line_total: resolved.line_total,
        },
      ],
      resolved.line_total,
    );

    await this.conversationRepo.updateContext(psid, {
      pending_product_id: productId,
      pending_quantity: quantity,
      pending_order_id: order.id,
    }, 'awaiting_order_confirm');

    this.logger.log(
      `draft order created psid=${psid} orderId=${order.id} productId=${productId} quantity=${quantity} total=${resolved.line_total}`,
    );
    this.addRecentMessage(psid, 'assistant', summary);
    await this.messenger.sendButtonTemplate(psid, summary, [
      { title: 'ยืนยันออเดอร์', payload: 'CONFIRM_ORDER' },
      { title: 'เปลี่ยนจำนวน', payload: 'CHANGE_QUANTITY' },
    ]);
  }

  private async confirmPendingOrder(
    psid: string,
    context: { pending_order_id?: string; pending_product_id?: string; pending_quantity?: number },
  ): Promise<void> {
    const orderId = context.pending_order_id;
    const productId = context.pending_product_id;
    const quantity = context.pending_quantity;
    this.logger.log(
      `confirmPendingOrder psid=${psid} orderId=${orderId ?? 'none'} productId=${productId ?? 'none'} quantity=${quantity ?? 'none'}`,
    );

    if (!orderId || !productId || !quantity) {
      await this.messenger.sendText(psid, 'ไม่พบออเดอร์ กรุณาสั่งซื้อใหม่ค่ะ');
      return;
    }

    const reserved = await this.productService.reserveStock(productId, quantity);
    if (!reserved) {
      await this.messenger.sendText(
        psid,
        'ขออภัยค่ะ สินค้าไม่เพียงพอ กรุณาลองใหม่',
      );
      return;
    }

    const order = await this.orderService.confirmOrder(orderId);
    if (!order) {
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
      { pending_order_id: orderId },
    );

    const paymentMsg = `✅ ยืนยันออเดอร์ ${order.order_number} แล้วค่ะ

💵 ยอดชำระ: ${Number(order.total_amount).toLocaleString()} บาท

🏦 โอนเข้าบัญชี:
${this.shopBankName}
${this.shopAccountName}
${this.shopBankAccount}

กรุณาโอนเงินแล้วส่งรูปสลิปมาในแชทนี้ค่ะ`;

    this.addRecentMessage(psid, 'assistant', paymentMsg);
    await this.messenger.sendText(psid, paymentMsg);

    await this.orderService.notifyAdmin('new_order', orderId, {
      psid,
      orderNumber: order.order_number,
      total: order.total_amount,
    });
    await this.messenger.notifyAdmin(
      `New order: ${order.order_number} — ${order.total_amount} THB`,
    );
    this.logger.log(
      `order confirmed psid=${psid} orderNumber=${order.order_number} total=${order.total_amount}`,
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

    this.addRecentMessage(psid, 'assistant', result.message);

    if (result.productId) {
      await this.rememberLastProduct(psid, result.productId);
      await this.messenger.sendButtonTemplate(psid, result.message, [
        { title: 'สั่งซื้อ', payload: `ORDER_PRODUCT:${result.productId}` },
        { title: 'ดูสินค้าอื่น', payload: 'VIEW_OTHER_PRODUCTS' },
      ]);
    } else {
      await this.messenger.sendText(psid, result.message);
    }

    return true;
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
