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
import {
  FacebookMessagingEvent,
  FacebookWebhookBody,
} from '../messenger/messenger.types';
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
    this.logger.log(
      `webhook verify attempt mode=${mode ?? 'missing'} tokenPresent=${Boolean(token)}`,
    );
    if (mode === 'subscribe' && this.webhookService.isValidVerifyToken(token)) {
      this.logger.log('webhook verify success');
      return challenge;
    }
    this.logger.warn('webhook verify failed: invalid token or mode');
    throw new UnauthorizedException('Invalid verify token');
  }

  @Post()
  @HttpCode(200)
  async handleWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Body() body: FacebookWebhookBody,
    @Headers('x-hub-signature-256') signature: string,
  ): Promise<string> {
    const entryCount = body?.entry?.length ?? 0;
    const eventCount = (body?.entry ?? []).reduce(
      (sum, entry) => sum + (entry.messaging?.length ?? 0),
      0,
    );
    this.logger.log(
      `webhook POST received object=${body?.object ?? 'unknown'} entries=${entryCount} events=${eventCount} signaturePresent=${Boolean(signature)} rawBodyBytes=${req.rawBody?.length ?? 'parsed'}`,
    );
    // this.logger.debug(`webhook POST body=${JSON.stringify(body)}`);

    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(body));

    if (!this.webhookService.verifySignature(signature, rawBody)) {
      this.logger.warn(
        'webhook POST rejected: invalid signature',
      );
      throw new UnauthorizedException('Invalid signature');
    }
    this.logger.log('webhook POST signature verified');

    if (body.object !== 'page') {
      this.logger.log(
        `webhook POST ignored non-page object=${body.object}`,
      );
      return 'EVENT_RECEIVED';
    }

    let dispatched = 0;
    for (const entry of body.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        dispatched++;
        this.logger.log(
          `dispatch event ${dispatched}/${eventCount} entryId=${entry.id} ${this.describeEvent(event)}`,
        );
        try {
          await this.conversationService.handleEvent(event);
        } catch (err) {
          this.logger.error(
            `event handler failed psid=${event.sender?.id ?? 'unknown'} ${this.describeEvent(event)}`,
            err instanceof Error ? err.stack : err,
          );
        }
      }
    }

    this.logger.log(
      `webhook POST complete dispatched=${dispatched}`,
    );
    return 'EVENT_RECEIVED';
  }

  private describeEvent(event: FacebookMessagingEvent): string {
    const psid = event.sender?.id ?? 'unknown';
    const mid = event.message?.mid;
    if (event.postback) {
      return `psid=${psid} type=postback payload=${event.postback.payload}`;
    }
    if (event.message?.attachments?.some((a) => a.type === 'image')) {
      return `psid=${psid} type=image mid=${mid ?? 'none'}`;
    }
    if (event.message?.text) {
      const preview = event.message.text.slice(0, 80).replace(/\s+/g, ' ');
      return `psid=${psid} type=text mid=${mid ?? 'none'} text="${preview}"`;
    }
    return `psid=${psid} type=unknown timestamp=${event.timestamp ?? 'none'}`;
  }
}
