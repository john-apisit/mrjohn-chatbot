import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import {
  CONVERSATION_STATE_TRANSITIONS,
  ConversationContext,
  ConversationState,
} from '../common/types/domain.types';
import { isConversationState } from '../common/types/guards';
import { ConversationRow } from '../order/order.types';

@Injectable()
export class ConversationRepository {
  private readonly logger = new Logger(ConversationRepository.name);

  constructor(private readonly supabase: SupabaseService) {}

  async getOrCreate(psid: string): Promise<ConversationRow> {
    this.logger.log(`getOrCreate start psid=${psid}`);
    const client = this.supabase.getClient();
    this.logger.log(`get supabase client done. psid=${psid}`);
    const { data: existing } = await client
      .from('conversations')
      .select('*')
      .eq('psid', psid)
      .maybeSingle();
    this.logger.log(`get data from conversations table done. psid=${psid}`);

    if (existing) {
      const row = this.mapRow(existing);
      this.logger.log(
        `getOrCreate found psid=${psid} state=${row.state} context=${JSON.stringify(row.context)}`,
      );
      return row;
    }

    this.logger.log(`getOrCreate inserting psid=${psid} state=idle`);
    const { data, error } = await client
      .from('conversations')
      .insert({ psid, state: 'idle', context: {} })
      .select()
      .single();

    if (error || !data) {
      this.logger.error(
        `getOrCreate failed psid=${psid} error=${error?.message ?? 'no data returned'}`,
      );
      throw new Error(`Failed to create conversation: ${error?.message}`);
    }
    const row = this.mapRow(data);
    this.logger.log(`getOrCreate created psid=${psid} id=${row.id}`);
    return row;
  }

  async updateState(
    psid: string,
    currentState: ConversationState,
    newState: ConversationState,
    context?: ConversationContext,
  ): Promise<ConversationRow> {
    this.logger.log(
      `updateState start psid=${psid} from=${currentState} to=${newState} context=${context !== undefined ? JSON.stringify(context) : 'unchanged'}`,
    );
    const allowed = CONVERSATION_STATE_TRANSITIONS[currentState];
    if (!allowed.includes(newState)) {
      this.logger.error(
        `updateState invalid transition psid=${psid} from=${currentState} to=${newState} allowed=${allowed.join(',')}`,
      );
      throw new Error(
        `Invalid conversation transition: ${currentState} → ${newState}`,
      );
    }

    const client = this.supabase.getClient();
    const update: Record<string, unknown> = {
      state: newState,
      updated_at: new Date().toISOString(),
    };
    if (context !== undefined) {
      update.context = context;
    }

    const { data, error } = await client
      .from('conversations')
      .update(update)
      .eq('psid', psid)
      .eq('state', currentState)
      .select()
      .single();

    if (error || !data) {
      this.logger.error(
        `updateState failed psid=${psid} from=${currentState} to=${newState} error=${error?.message ?? 'no rows updated'}`,
      );
      throw new Error(`Failed to update conversation: ${error?.message}`);
    }
    const row = this.mapRow(data);
    this.logger.log(
      `updateState success psid=${psid} state=${row.state} context=${JSON.stringify(row.context)}`,
    );
    return row;
  }

  async updateContext(
    psid: string,
    context: ConversationContext,
    state?: ConversationState,
  ): Promise<void> {
    this.logger.log(
      `updateContext start psid=${psid} state=${state ?? 'unchanged'} context=${JSON.stringify(context)}`,
    );
    const client = this.supabase.getClient();
    const update: Record<string, unknown> = {
      context,
      updated_at: new Date().toISOString(),
    };
    if (state) {
      update.state = state;
    }

    const { error } = await client
      .from('conversations')
      .update(update)
      .eq('psid', psid);

    if (error) {
      this.logger.error(
        `updateContext failed psid=${psid} error=${error.message}`,
      );
      throw new Error(`Failed to update context: ${error.message}`);
    }
    this.logger.log(`updateContext success psid=${psid}`);
  }

  private mapRow(row: Record<string, unknown>): ConversationRow {
    const state = row.state as string;
    if (!isConversationState(state)) {
      throw new Error(`Invalid conversation state: ${state}`);
    }
    return {
      id: row.id as string,
      psid: row.psid as string,
      state,
      context: (row.context ?? {}) as ConversationContext,
      updated_at: row.updated_at as string,
    };
  }
}
