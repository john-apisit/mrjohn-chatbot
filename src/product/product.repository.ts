import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { PriceTierRow, ProductRow, ProductWithTiers } from './product.types';

@Injectable()
export class ProductRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async listAllProducts(): Promise<ProductRow[]> {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('products')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) {
      throw new Error(`Product list failed: ${error.message}`);
    }
    return (data ?? []) as ProductRow[];
  }

  async listProducts(limit = 5): Promise<ProductRow[]> {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('products')
      .select('*')
      .eq('is_active', true)
      .order('name')
      .limit(limit);

    if (error) {
      throw new Error(`Product list failed: ${error.message}`);
    }
    return (data ?? []) as ProductRow[];
  }

  async searchProducts(query: string, limit = 5): Promise<ProductRow[]> {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('products')
      .select('*')
      .eq('is_active', true)
      .or(`name.ilike.%${query}%,description.ilike.%${query}%`)
      .limit(limit);

    if (error) {
      throw new Error(`Product search failed: ${error.message}`);
    }
    return (data ?? []) as ProductRow[];
  }

  async getProductById(id: string): Promise<ProductWithTiers | null> {
    const client = this.supabase.getClient();
    const { data: product, error } = await client
      .from('products')
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (error || !product) {
      return null;
    }

    const tiers = await this.getPriceTiers(id);
    return { ...(product as ProductRow), price_tiers: tiers };
  }

  async getPriceTiers(productId: string): Promise<PriceTierRow[]> {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('product_price_tiers')
      .select('*')
      .eq('product_id', productId)
      .order('min_qty', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch price tiers: ${error.message}`);
    }
    return (data ?? []) as PriceTierRow[];
  }

  async checkStock(id: string, qty: number): Promise<boolean> {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('products')
      .select('stock_qty')
      .eq('id', id)
      .single();

    if (error || !data) {
      return false;
    }
    return (data as { stock_qty: number }).stock_qty >= qty;
  }

  async reserveStock(id: string, qty: number): Promise<boolean> {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('products')
      .select('stock_qty')
      .eq('id', id)
      .single();

    if (error || !data) {
      return false;
    }

    const current = (data as { stock_qty: number }).stock_qty;
    if (current < qty) {
      return false;
    }

    const { error: updateError } = await client
      .from('products')
      .update({ stock_qty: current - qty })
      .eq('id', id)
      .eq('stock_qty', current);

    return !updateError;
  }
}
