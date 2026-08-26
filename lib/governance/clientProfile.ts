// Client Profile — AI Account Manager identity + multilingual preference
// (Sections 15 & 16). Configuration read, not a new agent: Temo's own
// prompt is personalized per-tenant (assistant name, response language)
// without any new agent implementation existing per customer.

import { supabase } from '@/lib/supabase/client';

export interface ClientProfile {
  tenantId: string;
  assistantName: string;
  preferredLanguage: string;
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  ar: 'Arabic',
};

export async function getClientProfile(tenantId: string | null): Promise<ClientProfile | null> {
  if (!tenantId) return null;
  const { data, error } = await supabase
    .from('client_profiles')
    .select('tenant_id, assistant_name, preferred_language')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error || !data) return null;
  return {
    tenantId: data.tenant_id as string,
    assistantName: (data.assistant_name as string) || 'Temo',
    preferredLanguage: (data.preferred_language as string) || 'en',
  };
}

/**
 * A short directive appended to any agent's system prompt so responses
 * honor the client's chosen assistant name and language (Sections 15–16).
 * Returns '' for the default (English, name "Temo") case — no directive
 * needed when nothing is customized.
 */
export function buildIdentityDirective(profile: ClientProfile | null): string {
  if (!profile) return '';
  const parts: string[] = [];
  if (profile.assistantName && profile.assistantName.toLowerCase() !== 'temo') {
    parts.push(`This client refers to you as "${profile.assistantName}" — respond as that identity while your underlying role and capabilities are unchanged.`);
  }
  if (profile.preferredLanguage && profile.preferredLanguage !== 'en') {
    const langName = LANGUAGE_NAMES[profile.preferredLanguage] ?? profile.preferredLanguage;
    parts.push(`Respond in ${langName}, regardless of the language technical documentation or internal notes are written in.`);
  }
  if (parts.length === 0) return '';
  return `\n\n## Client Preferences\n${parts.join('\n')}`;
}
