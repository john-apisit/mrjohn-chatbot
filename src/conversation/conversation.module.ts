import { Module } from '@nestjs/common';
import { IntentClassifier } from './intent/intent.classifier';
import { ConversationRepository } from './conversation.repository';
import { ConversationService } from './conversation.service';
import { ProductAnswerService } from './product-answer.service';
import { ShopFaqService } from './shop-faq.service';
import { ProductModule } from '../product/product.module';
import { OrderModule } from '../order/order.module';
import { SlipModule } from '../slip/slip.module';
import { MessengerModule } from '../messenger/messenger.module';

@Module({
  imports: [ProductModule, OrderModule, SlipModule, MessengerModule],
  providers: [
    ConversationRepository,
    ConversationService,
    IntentClassifier,
    ProductAnswerService,
    ShopFaqService,
  ],
  exports: [ConversationService],
})
export class ConversationModule {}
