import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import {
  ORDER_STATUS_TRANSITIONS,
  OrderItem,
  OrderStatus,
} from '../common/types/domain.types';
import { isOrderStatus } from '../common/types/guards';
import { OrderRow } from './order.types';

@Injectable()
export class OrderRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async createOrder(
    psid: string,
    items: OrderItem[],
    totalAmount: number,
  ): Promise<OrderRow> {
    const orderNumber = this.generateOrderNumber();
    const client = this.supabase.getClient();

    const { data, error } = await client
      .from('orders')
      .insert({
        psid,
        order_number: orderNumber,
        status: 'draft' satisfies OrderStatus,
        items,
        total_amount: totalAmount,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create order: ${error?.message}`);
    }
    return this.mapOrder(data);
  }

  async getOrderById(id: string): Promise<OrderRow | null> {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return null;
    }
    return this.mapOrder(data);
  }

  async getLatestOrderByPsid(
    psid: string,
    statuses?: OrderStatus[],
  ): Promise<OrderRow | null> {
    const client = this.supabase.getClient();
    let query = client
      .from('orders')
      .select('*')
      .eq('psid', psid)
      .order('created_at', { ascending: false })
      .limit(1);

    if (statuses?.length) {
      query = query.in('status', statuses);
    }

    const { data, error } = await query.maybeSingle();
    if (error || !data) {
      return null;
    }
    return this.mapOrder(data);
  }

  async updateOrderStatus(
    id: string,
    currentStatus: OrderStatus,
    newStatus: OrderStatus,
  ): Promise<OrderRow | null> {
    const allowed = ORDER_STATUS_TRANSITIONS[currentStatus];
    if (!allowed.includes(newStatus)) {
      throw new Error(
        `Invalid status transition: ${currentStatus} → ${newStatus}`,
      );
    }

    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('orders')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', currentStatus)
      .select()
      .single();

    if (error || !data) {
      return null;
    }
    return this.mapOrder(data);
  }

  async markOrderPaid(
    id: string,
    slipUrl: string,
    transRef: string,
  ): Promise<OrderRow | null> {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('orders')
      .update({
        status: 'paid' satisfies OrderStatus,
        slip_url: slipUrl,
        slip_verified: true,
        slip_transaction_id: transRef,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .in('status', ['draft', 'pending_payment'])
      .select()
      .single();

    if (error || !data) {
      return null;
    }
    return this.mapOrder(data);
  }

  async setPendingPayment(id: string): Promise<OrderRow | null> {
    return this.updateOrderStatus(id, 'draft', 'pending_payment');
  }

  private generateOrderNumber(): string {
    const date = new Date();
    const prefix = date.toISOString().slice(0, 10).replace(/-/g, '');
    const random = Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, '0');
    return `ORD-${prefix}-${random}`;
  }

  private mapOrder(row: Record<string, unknown>): OrderRow {
    const status = row.status as string;
    if (!isOrderStatus(status)) {
      throw new Error(`Invalid order status: ${status}`);
    }
    return {
      id: row.id as string,
      psid: row.psid as string,
      order_number: row.order_number as string,
      status,
      items: row.items as OrderItem[],
      total_amount: row.total_amount as number | null,
      shipping_address: row.shipping_address as string | null,
      slip_url: row.slip_url as string | null,
      slip_verified: row.slip_verified as boolean,
      slip_transaction_id: row.slip_transaction_id as string | null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }
}
