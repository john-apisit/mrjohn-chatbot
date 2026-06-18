import { Injectable } from '@nestjs/common';
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
  constructor(private readonly supabase: SupabaseService) {}

  async getOrCreate(psid: string): Promise<ConversationRow> {
    const client = this.supabase.getClient();
    const { data: existing } = await client
      .from('conversations')
      .select('*')
      .eq('psid', psid)
      .maybeSingle();

    if (existing) {
      return this.mapRow(existing);
    }

    const { data, error } = await client
      .from('conversations')
      .insert({ psid, state: 'idle', context: {} })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create conversation: ${error?.message}`);
    }
    return this.mapRow(data);
  }

  async updateState(
    psid: string,
    currentState: ConversationState,
    newState: ConversationState,
    context?: ConversationContext,
  ): Promise<ConversationRow> {
    const allowed = CONVERSATION_STATE_TRANSITIONS[currentState];
    if (!allowed.includes(newState)) {
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
      throw new Error(`Failed to update conversation: ${error?.message}`);
    }
    return this.mapRow(data);
  }

  async updateContext(
    psid: string,
    context: ConversationContext,
    state?: ConversationState,
  ): Promise<void> {
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
      throw new Error(`Failed to update context: ${error.message}`);
    }
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
