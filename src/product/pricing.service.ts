import { Injectable } from '@nestjs/common';
import { PriceTierRow, ResolvedPrice } from './product.types';

@Injectable()
export class PricingService {
  resolveUnitPrice(tiers: PriceTierRow[], quantity: number): PriceTierRow {
    const applicable = tiers
      .filter((t) => quantity >= t.min_qty)
      .sort((a, b) => b.min_qty - a.min_qty);

    if (!applicable.length) {
      throw new Error('Quantity below minimum order');
    }
    return applicable[0];
  }

  calcLineTotal(tier: PriceTierRow, quantity: number): number {
    return Number(tier.unit_price) * quantity;
  }

  resolvePrice(tiers: PriceTierRow[], quantity: number): ResolvedPrice {
    const tier = this.resolveUnitPrice(tiers, quantity);
    return {
      unit_price: Number(tier.unit_price),
      min_qty: tier.min_qty,
      line_total: this.calcLineTotal(tier, quantity),
    };
  }
}
