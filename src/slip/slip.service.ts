import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import {
  SLIPOK_ERROR_MESSAGES,
  SlipOkFailure,
  SlipOkResult,
  SlipOkSuccess,
} from './slip.types';

@Injectable()
export class SlipService {
  private readonly logger = new Logger(SlipService.name);
  private readonly apiUrl: string;
  private readonly apiKey: string;

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
  ) {
    this.apiUrl = this.config.getOrThrow<string>('SLIPOK_API_URL');
    this.apiKey = this.config.getOrThrow<string>('SLIPOK_API_KEY');
  }

  async verifySlipFromImage(
    imageBuffer: Buffer,
    expectedAmount: number,
    filename = 'slip.jpg',
  ): Promise<SlipOkResult> {
    const { signedUrl } = await this.supabase.uploadSlip(
      imageBuffer,
      filename,
    );

    try {
      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'x-authorization': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: signedUrl,
          amount: expectedAmount,
          log: true,
        }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        code?: number;
        message?: string;
        data?: {
          transRef: string;
          amount: number;
          transDate: string;
          transTime: string;
        };
      };

      if (!data.success || !data.data) {
        return {
          ok: false,
          code: data.code ?? 0,
          message: data.message ?? 'Unknown slip verification error',
        } satisfies SlipOkFailure;
      }

      return {
        ok: true,
        transRef: data.data.transRef,
        amount: data.data.amount,
        transDate: data.data.transDate,
        transTime: data.data.transTime,
        slipUrl: signedUrl,
      } satisfies SlipOkSuccess;
    } catch (err) {
      this.logger.error('SlipOK API call failed', err);
      return {
        ok: false,
        code: 0,
        message: 'ไม่สามารถตรวจสลิปได้ในขณะนี้ กรุณาลองใหม่ค่ะ',
      };
    }
  }

  getUserMessageForError(code: number, fallbackMessage: string): string {
    return SLIPOK_ERROR_MESSAGES[code]?.userMessage ?? fallbackMessage;
  }

  shouldEscalate(code: number): boolean {
    return SLIPOK_ERROR_MESSAGES[code]?.escalate ?? true;
  }

  async downloadImageFromUrl(
    url: string,
    accessToken: string,
  ): Promise<Buffer> {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Failed to download image: ${res.status}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
