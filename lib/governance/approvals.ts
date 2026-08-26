// Approval Gates — V1 human-in-the-loop mechanism (Section 8).
//
// Reusable across tools, missions, and spend. A gated action creates a
// `pending` row and stops; a human resolves it via resolveApproval(); the
// caller re-checks isApproved() before actually executing. This module
// never executes anything itself — it only records the decision.

import { supabase } from '@/lib/supabase/client';

export type ApprovalType = 'tool_execution' | 'spend' | 'publish' | 'destructive_action';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface ApprovalRequest {
  id: string;
  tenantId: string | null;
  type: ApprovalType;
  title: string;
  detail: string;
  payload: Record<string, unknown>;
  requestedBy: string;
  missionId: string | null;
  taskId: string | null;
  status: ApprovalStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

interface ApprovalRow {
  id: string;
  tenant_id: string | null;
  type: string;
  title: string;
  detail: string;
  payload: Record<string, unknown>;
  requested_by: string;
  mission_id: string | null;
  task_id: string | null;
  status: string;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

function mapRow(row: ApprovalRow): ApprovalRequest {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    type: row.type as ApprovalType,
    title: row.title,
    detail: row.detail,
    payload: row.payload ?? {},
    requestedBy: row.requested_by,
    missionId: row.mission_id,
    taskId: row.task_id,
    status: row.status as ApprovalStatus,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  };
}

export async function requestApproval(input: {
  tenantId: string | null;
  type: ApprovalType;
  title: string;
  detail?: string;
  payload?: Record<string, unknown>;
  requestedBy: string;
  missionId?: string | null;
  taskId?: string | null;
}): Promise<ApprovalRequest | null> {
  const { data, error } = await supabase
    .from('approval_requests')
    .insert({
      tenant_id: input.tenantId,
      type: input.type,
      title: input.title,
      detail: input.detail ?? '',
      payload: input.payload ?? {},
      requested_by: input.requestedBy,
      mission_id: input.missionId ?? null,
      task_id: input.taskId ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error('[approvals] Failed to create approval request:', error.message);
    return null;
  }
  return mapRow(data as ApprovalRow);
}

export async function resolveApproval(
  id: string,
  decision: 'approved' | 'rejected',
  resolvedBy: string,
): Promise<ApprovalRequest | null> {
  const { data, error } = await supabase
    .from('approval_requests')
    .update({ status: decision, resolved_by: resolvedBy, resolved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending') // only a still-pending request can be resolved
    .select()
    .maybeSingle();

  if (error || !data) return null;
  return mapRow(data as ApprovalRow);
}

export async function getApproval(id: string): Promise<ApprovalRequest | null> {
  const { data, error } = await supabase.from('approval_requests').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return mapRow(data as ApprovalRow);
}

export async function listPendingApprovals(tenantId?: string): Promise<ApprovalRequest[]> {
  let query = supabase.from('approval_requests').select('*').eq('status', 'pending').order('created_at', { ascending: false });
  if (tenantId) query = query.eq('tenant_id', tenantId);
  const { data, error } = await query;
  if (error || !data) return [];
  return (data as ApprovalRow[]).map(mapRow);
}
