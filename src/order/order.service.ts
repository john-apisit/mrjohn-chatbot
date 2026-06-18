import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AdminNotificationType, OrderItem } from '../common/types/domain.types';
import { OrderRepository } from './order.repository';
import { OrderRow } from './order.types';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly repository: OrderRepository,
    private readonly supabase: SupabaseService,
  ) {}

  createDraftOrder(
    psid: string,
    items: OrderItem[],
    totalAmount: number,
  ): Promise<OrderRow> {
    return this.repository.createOrder(psid, items, totalAmount);
  }

  getOrderById(id: string): Promise<OrderRow | null> {
    return this.repository.getOrderById(id);
  }

  getLatestOrderByPsid(psid: string): Promise<OrderRow | null> {
    return this.repository.getLatestOrderByPsid(psid);
  }

  getPendingPaymentOrder(psid: string): Promise<OrderRow | null> {
    return this.repository.getLatestOrderByPsid(psid, [
      'draft',
      'pending_payment',
    ]);
  }

  confirmOrder(orderId: string): Promise<OrderRow | null> {
    return this.repository.setPendingPayment(orderId);
  }

  markPaid(
    orderId: string,
    slipUrl: string,
    transRef: string,
  ): Promise<OrderRow | null> {
    return this.repository.markOrderPaid(orderId, slipUrl, transRef);
  }

  formatOrderStatus(order: OrderRow): string {
    const statusLabels: Record<string, string> = {
      draft: 'ร่างออเดอร์',
      pending_payment: 'รอชำระเงิน',
      paid: 'ชำระเงินแล้ว',
      shipped: 'จัดส่งแล้ว',
      cancelled: 'ยกเลิก',
    };

    const items = order.items
      .map(
        (i) =>
          `• ${i.name} × ${i.qty.toLocaleString()} = ${i.line_total.toLocaleString()} บาท`,
      )
      .join('\n');

    return `📋 ออเดอร์: ${order.order_number}
📌 สถานะ: ${statusLabels[order.status] ?? order.status}

${items}

💵 รวม: ${Number(order.total_amount ?? 0).toLocaleString()} บาท`;
  }

  async notifyAdmin(
    type: AdminNotificationType,
    orderId: string | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const client = this.supabase.getClient();
    const { error } = await client.from('admin_notifications').insert({
      type,
      order_id: orderId,
      payload,
    });

    if (error) {
      this.logger.error(`Failed to create admin notification: ${error.message}`);
    }
  }
}
