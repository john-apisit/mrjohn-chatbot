import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  Query,
  Req,
  UnauthorizedException,
  Logger,
  HttpCode,
} from '@nestjs/common';
import { Request } from 'express';
import { ConversationService } from '../conversation/conversation.service';
import { FacebookWebhookBody } from '../messenger/messenger.types';
import { WebhookService } from './webhook.service';

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly webhookService: WebhookService,
    private readonly conversationService: ConversationService,
  ) {}

  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    if (mode === 'subscribe' && this.webhookService.isValidVerifyToken(token)) {
      this.logger.log('Webhook verified');
      return challenge;
    }
    throw new UnauthorizedException('Invalid verify token');
  }

  @Post()
  @HttpCode(200)
  async handleWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Body() body: FacebookWebhookBody,
    @Headers('x-hub-signature-256') signature: string,
  ): Promise<string> {
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(body));

    if (!this.webhookService.verifySignature(signature, rawBody)) {
      throw new UnauthorizedException('Invalid signature');
    }

    if (body.object !== 'page') {
      return 'EVENT_RECEIVED';
    }

    for (const entry of body.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        this.conversationService.handleEvent(event).catch((err) => {
          this.logger.error('Failed to handle messaging event', err);
        });
      }
    }

    return 'EVENT_RECEIVED';
  }
}
