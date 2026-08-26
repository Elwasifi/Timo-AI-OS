// Memory Settings — loads and saves the memory engine configuration from
// the memory_settings table (single row, id=1).

import { supabase } from '@/lib/supabase/client';
import type { MemorySettings } from './types';
import { DEFAULT_MEMORY_SETTINGS } from './types';

export async function loadMemorySettings(): Promise<MemorySettings> {
  const { data, error } = await supabase
    .from('memory_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (error || !data) return DEFAULT_MEMORY_SETTINGS;
  return data as MemorySettings;
}

export async function saveMemorySettings(patch: Partial<MemorySettings>): Promise<MemorySettings> {
  const { data, error } = await supabase
    .from('memory_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', 1)
    .select()
    .maybeSingle();
  if (error) throw new Error(`Failed to save memory settings: ${error.message}`);
  return (data as MemorySettings) ?? DEFAULT_MEMORY_SETTINGS;
}
