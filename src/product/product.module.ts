import { Module } from '@nestjs/common';
import { ProductRepository } from './product.repository';
import { ProductService } from './product.service';
import { PricingService } from './pricing.service';

@Module({
  providers: [ProductRepository, ProductService, PricingService],
  exports: [ProductService, PricingService],
})
export class ProductModule {}
