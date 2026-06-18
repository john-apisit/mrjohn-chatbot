import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);
  private client!: SupabaseClient;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const url = this.config.getOrThrow<string>('SUPABASE_URL');
    const key = this.config.getOrThrow<string>('SUPABASE_SECRET_KEY');
    this.client = createClient(url, key);
    this.logger.log('Supabase client initialized');
  }

  getClient(): SupabaseClient {
    return this.client;
  }

  async uploadSlip(
    buffer: Buffer,
    filename: string,
  ): Promise<{ path: string; signedUrl: string }> {
    const path = `${Date.now()}-${filename}`;
    const { error } = await this.client.storage
      .from('slips')
      .upload(path, buffer, { contentType: 'image/jpeg', upsert: false });

    if (error) {
      throw new Error(`Failed to upload slip: ${error.message}`);
    }

    const { data, error: signError } = await this.client.storage
      .from('slips')
      .createSignedUrl(path, 3600);

    if (signError || !data?.signedUrl) {
      throw new Error(
        `Failed to create signed URL: ${signError?.message ?? 'unknown'}`,
      );
    }

    return { path, signedUrl: data.signedUrl };
  }
}
