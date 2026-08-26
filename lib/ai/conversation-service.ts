import { supabase } from '@/lib/supabase/client';

export interface ConversationRecord {
  id: string;
  title: string;
  agent_id: string;
  created_at: string;
  updated_at: string;
}

export interface MessageRecord {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  agent_id: string | null;
  confidence: number | null;
  created_at: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * ConversationService — persists chat history to Supabase so conversations
 * survive across sessions. Each conversation has messages with role,
 * content, and the agent that produced it.
 */
export const ConversationService = {
  async createConversation(title: string, agentId: string = 'temo', tenantId: string): Promise<ConversationRecord> {
    const { data, error } = await supabase
      .from('conversations')
      .insert({ title, agent_id: agentId, tenant_id: tenantId })
      .select()
      .single();
    if (error) throw new Error(`Failed to create conversation: ${error.message}`);
    return data;
  },

  async getConversations(limit = 20): Promise<ConversationRecord[]> {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.error('[conversations] load error:', error.message);
      return [];
    }
    return data ?? [];
  },

  async getMessages(conversationId: string): Promise<MessageRecord[]> {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('[messages] load error:', error.message);
      return [];
    }
    return data ?? [];
  },

  async addMessage(
    conversationId: string,
    role: ChatMessage['role'],
    content: string,
    agentId: string | null = null,
    confidence: number | null = null
  ): Promise<MessageRecord> {
    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        role,
        content,
        agent_id: agentId,
        confidence,
      })
      .select()
      .single();
    if (error) throw new Error(`Failed to save message: ${error.message}`);

    // Update conversation timestamp
    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);

    return data;
  },

  async deleteConversation(conversationId: string): Promise<void> {
    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', conversationId);
    if (error) throw new Error(`Failed to delete conversation: ${error.message}`);
  },

  async updateConversationTitle(conversationId: string, title: string): Promise<void> {
    const { error } = await supabase
      .from('conversations')
      .update({ title, updated_at: new Date().toISOString() })
      .eq('id', conversationId);
    if (error) throw new Error(`Failed to update title: ${error.message}`);
  },
};
