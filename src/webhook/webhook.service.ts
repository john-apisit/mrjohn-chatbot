import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class WebhookService {
  private readonly appSecret: string;
  private readonly expectedVerifyToken: string;

  constructor(private readonly config: ConfigService) {
    this.appSecret = this.config.getOrThrow<string>('FACEBOOK_APP_SECRET');
    this.expectedVerifyToken = this.config.getOrThrow<string>(
      'FACEBOOK_VERIFY_TOKEN',
    );
  }

  isValidVerifyToken(token: string): boolean {
    return token === this.expectedVerifyToken;
  }

  verifySignature(signature: string | undefined, rawBody: Buffer): boolean {
    if (!signature) {
      return false;
    }

    const expected =
      'sha256=' +
      crypto.createHmac('sha256', this.appSecret).update(rawBody).digest('hex');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected),
      );
    } catch {
      return false;
    }
  }
}
