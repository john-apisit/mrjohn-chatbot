import { Injectable } from '@nestjs/common';
import { ProductRepository } from './product.repository';
import { PricingService } from './pricing.service';
import {
  ProductRow,
  ProductWithTiers,
  ResolvedPrice,
} from './product.types';

@Injectable()
export class ProductService {
  constructor(
    private readonly repository: ProductRepository,
    private readonly pricing: PricingService,
  ) {}

  listProducts(): Promise<ProductRow[]> {
    return this.repository.listProducts();
  }

  searchProducts(query: string): Promise<ProductRow[]> {
    return this.repository.searchProducts(query);
  }

  getProductById(id: string): Promise<ProductWithTiers | null> {
    return this.repository.getProductById(id);
  }

  getPriceTiers(productId: string) {
    return this.repository.getPriceTiers(productId);
  }

  async resolvePrice(
    productId: string,
    qty: number,
  ): Promise<ResolvedPrice & { product: ProductWithTiers }> {
    const product = await this.repository.getProductById(productId);
    if (!product) {
      throw new Error('Product not found');
    }
    const price = this.pricing.resolvePrice(product.price_tiers, qty);
    return { ...price, product };
  }

  checkStock(id: string, qty: number): Promise<boolean> {
    return this.repository.checkStock(id, qty);
  }

  reserveStock(id: string, qty: number): Promise<boolean> {
    return this.repository.reserveStock(id, qty);
  }

  formatProductMessage(product: ProductWithTiers): string {
    const tiers = [...product.price_tiers].sort(
      (a, b) => b.min_qty - a.min_qty,
    );
    const tierLines = tiers
      .map(
        (t) =>
          `   • ${t.min_qty.toLocaleString()} ชิ้นขึ้นไป → ${Number(t.unit_price).toLocaleString()} บาท/ชิ้น`,
      )
      .join('\n');

    return `📦 สินค้า: ${product.name}
📊 คงเหลือ: ${product.stock_qty.toLocaleString()} ชิ้น

💰 ราคาตามจำนวน:
${tierLines}`;
  }

  formatOrderSummary(
    productName: string,
    qty: number,
    unitPrice: number,
    minQtyTier: number,
    lineTotal: number,
  ): string {
    return `📦 ${productName} × ${qty.toLocaleString()} ชิ้น
💰 ${unitPrice.toLocaleString()} บาท/ชิ้น (ขั้นต่ำ ${minQtyTier.toLocaleString()} ชิ้น)
━━━━━━━━━━━━━━━━
💵 รวม: ${lineTotal.toLocaleString()} บาท`;
  }
}
