import { Module } from '@nestjs/common';
import { OrderRepository } from './order.repository';
import { OrderService } from './order.service';

@Module({
  providers: [OrderRepository, OrderService],
  exports: [OrderService, OrderRepository],
})
export class OrderModule {}
