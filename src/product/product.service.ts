import { Injectable } from '@nestjs/common';
import { CartItem } from '../common/types/domain.types';
import { ProductRepository } from './product.repository';
import { PricingService } from './pricing.service';
import {
  ProductCatalogEntry,
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

  listAllProducts(): Promise<ProductRow[]> {
    return this.repository.listAllProducts();
  }

  listFeaturedProducts(): Promise<ProductRow[]> {
    return this.repository.listFeaturedProducts();
  }

  listCatalogEntries(): Promise<
    Array<ProductRow & { price_tiers: import('./product.types').PriceTierRow[] }>
  > {
    return this.repository.listCatalogEntries();
  }

  getProductsByIds(ids: string[]): Promise<ProductRow[]> {
    return this.repository.getProductsByIds(ids);
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

  releaseStock(id: string, qty: number): Promise<void> {
    return this.repository.releaseStock(id, qty);
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

    const description = product.description
      ? `\n📝 ${product.description}`
      : '';

    return `📦 สินค้า: ${product.name}
📊 คงเหลือ: ${product.stock_qty.toLocaleString()} ชิ้น${description}

💰 ราคาตามจำนวน:
${tierLines}`;
  }

  formatPriceQuote(
    productName: string,
    qty: number,
    unitPrice: number,
    minQtyTier: number,
    lineTotal: number,
    inStock: boolean,
  ): string {
    const stockLine = inStock
      ? '✅ สต็อกพอสำหรับจำนวนนี้'
      : '⚠️ สต็อกไม่พอสำหรับจำนวนนี้ กรุณาลดจำนวนหรือติดต่อแอดมิน';

    return `💰 คำนวณราคา

📦 ${productName} × ${qty.toLocaleString()} ชิ้น
   ${unitPrice.toLocaleString()} บาท/ชิ้น (ขั้นต่ำ ${minQtyTier.toLocaleString()} ชิ้น)
━━━━━━━━━━━━━━━━
💵 รวม: ${lineTotal.toLocaleString()} บาท

${stockLine}`;
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

  formatCartSummary(items: CartItem[]): string {
    const lines = items.map(
      (item) =>
        `• ${item.name} × ${item.qty.toLocaleString()} = ${item.line_total.toLocaleString()} บาท`,
    );
    const total = items.reduce((sum, item) => sum + item.line_total, 0);
    return `🛒 ตะกร้าสินค้า (${items.length} รายการ)

${lines.join('\n')}
━━━━━━━━━━━━━━━━
💵 รวมทั้งหมด: ${total.toLocaleString()} บาท`;
  }

  toCatalogEntry(
    product: ProductRow & {
      price_tiers: Array<{ min_qty: number; unit_price: number }>;
    },
  ): ProductCatalogEntry {
    return {
      id: product.id,
      name: product.name,
      description: product.description ?? '',
      stock_qty: product.stock_qty,
      is_featured: product.is_featured ?? false,
      price_tiers: product.price_tiers.map((tier) => ({
        min_qty: tier.min_qty,
        unit_price: Number(tier.unit_price),
      })),
    };
  }
}
