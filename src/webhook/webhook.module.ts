import { Module } from '@nestjs/common';
import { ConversationModule } from '../conversation/conversation.module';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

@Module({
  imports: [ConversationModule],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class WebhookModule {}
