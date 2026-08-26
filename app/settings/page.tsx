'use client';

import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { User, Bell, Shield, Palette, Volume2, Sparkles, Check, Loader2, Eye, EyeOff, Save, Workflow, Wifi, AlertCircle, Brain, Users, UserPlus, Trash2, Pencil, Globe, ShieldAlert, X as XIcon, CheckCircle2, XCircle, AlertTriangle, Clock, Settings as SettingsIcon } from 'lucide-react';
import { AppShell } from '@/components/temo/app-shell';
import { useDashboardStore } from '@/stores/dashboardStore';
import { useVoiceStore } from '@/stores/voiceStore';
import { voiceManager } from '@/lib/voice/voice-manager';
import {
  loadSettings, saveSettings, PROVIDER_MODELS, PROVIDER_LABELS,
  PROVIDER_MODEL_FIELD, type AppSettings, type ProviderId,
  type ModelInfo, type ProviderValidationResult, type ProviderValidationStatus,
} from '@/lib/settings/settings-service';
import { loadCachedValidation, saveCachedValidation } from '@/lib/settings/providerModelCache';
import { testConnection, type ConnectionTestResult } from '@/services/n8n';
import { loadMemorySettings, saveMemorySettings } from '@/lib/memory/memorySettings';
import type { MemorySettings } from '@/lib/memory/types';
import type { VoiceLanguage } from '@/types';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { authFetch } from '@/lib/api/authFetch';
import type { TaskType } from '@/lib/ai/router';

const ROUTING_TASK_TYPES: TaskType[] = [
  'VOICE', 'FAST_CHAT', 'NORMAL_CHAT', 'AGENT_TO_AGENT', 'SMALL_TASK', 'CODING',
  'RESEARCH', 'PLANNING', 'COMPLEX_REASONING', 'LARGE_MISSION', 'TOOL_EXECUTION',
  'VISION', 'STRUCTURED_OUTPUT',
];
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase/client';

const SECTIONS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'workspace', label: 'Workspace & Language', icon: Globe },
  { id: 'approvals', label: 'Approvals', icon: ShieldAlert },
  { id: 'agents', label: 'Agent Management', icon: Users },
  { id: 'providers', label: 'AI Providers', icon: Sparkles },
  { id: 'memory', label: 'Memory Engine', icon: Brain },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'privacy', label: 'Privacy & Security', icon: Shield },
  { id: 'voice', label: 'Voice', icon: Volume2 },
  { id: 'n8n', label: 'n8n', icon: Workflow },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

const VALIDATION_STATUS_META: Record<
  ProviderValidationStatus | 'idle' | 'validating',
  { label: string; className: string }
> = {
  idle: { label: 'Not Validated', className: 'text-muted-foreground' },
  validating: { label: 'Validating…', className: 'text-primary' },
  connected: { label: 'Connected', className: 'text-success' },
  not_configured: { label: 'Not Configured', className: 'text-muted-foreground' },
  invalid_api_key: { label: 'Invalid API Key', className: 'text-destructive' },
  unauthorized: { label: 'Unauthorized', className: 'text-destructive' },
  unsupported: { label: 'Unsupported', className: 'text-amber-400' },
  rate_limited: { label: 'Rate Limited', className: 'text-amber-400' },
  provider_unavailable: { label: 'Provider Unavailable', className: 'text-destructive' },
  provider_timeout: { label: 'Timeout', className: 'text-amber-400' },
  configuration_error: { label: 'Configuration Error', className: 'text-destructive' },
  unknown_error: { label: 'Unknown Error', className: 'text-destructive' },
};

function formatPrice(price: number | null | undefined): string | null {
  if (price === null || price === undefined) return null;
  if (price === 0) return '$0';
  return `$${price < 0.01 ? price.toFixed(4) : price.toFixed(2)}`;
}

function formatContextLength(n: number | undefined): string | null {
  if (!n) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M ctx`;
  if (n >= 1_000) return `${Math.round(n / 1000)}K ctx`;
  return `${n} ctx`;
}

export default function SettingsPage() {
  const [active, setActive] = useState<SectionId>('profile');
  const providers = useDashboardStore((s) => s.providers);
  const currentId = useDashboardStore((s) => s.currentProviderId);
  const setCurrentProvider = useDashboardStore((s) => s.setCurrentProvider);

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="font-sans text-2xl font-bold tracking-tight text-temo-led">Settings</h1>
          <p className="font-mono text-xs text-temo-titanium">Configure your Temo workspace</p>
        </div>

        <div className="flex flex-col gap-6 md:flex-row">
          <div className="flex shrink-0 flex-row gap-1 overflow-x-auto md:flex-col">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.id}
                  onClick={() => setActive(s.id)}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-all whitespace-nowrap',
                    active === s.id
                      ? 'bg-primary/10 text-primary border border-primary/30'
                      : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {s.label}
                </button>
              );
            })}
          </div>

          <div className="flex-1">
            <motion.div
              key={active}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl temo-glass p-6"
            >
              {active === 'profile' && <ProfileSection />}
              {active === 'workspace' && <WorkspaceSection />}
              {active === 'approvals' && <ApprovalsSection />}
              {active === 'agents' && <AgentsSection />}
              {active === 'providers' && (
                <ProvidersSection
                  providers={providers}
                  currentId={currentId}
                  onSelect={setCurrentProvider}
                />
              )}
              {active === 'notifications' && <NotificationsSection />}
              {active === 'memory' && <MemorySection />}
              {active === 'appearance' && <AppearanceSection />}
              {active === 'privacy' && <PrivacySection />}
              {active === 'voice' && <VoiceSection />}
              {active === 'n8n' && <N8nSection />}
            </motion.div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/40 py-3 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

function ProfileSection() {
  return (
    <div>
      <h2 className="font-grotesk text-lg font-semibold">Profile</h2>
      <p className="mt-1 text-sm text-muted-foreground">Your account information</p>
      <div className="mt-4 flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/30 to-secondary/30 text-2xl font-bold text-primary">
          A
        </div>
        <div>
          <div className="text-base font-semibold">Alex Rivera</div>
          <div className="text-sm text-muted-foreground">alex@temo.ai</div>
        </div>
      </div>
      <div className="mt-6">
        <Field label="Display name" value="Alex Rivera" />
        <Field label="Email" value="alex@temo.ai" />
        <Field label="Time zone" value="Pacific (UTC-8)" />
        <Field label="Plan" value="Pro" />
      </div>
    </div>
  );
}

function WorkspaceSection() {
  const currentTenantId = useAuthStore((s) => s.currentTenantId);
  const tenants = useAuthStore((s) => s.tenants);
  const [assistantName, setAssistantName] = useState('Temo');
  const [language, setLanguage] = useState('en');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const currentTenant = tenants.find((t) => t.tenantId === currentTenantId);

  useEffect(() => {
    if (!currentTenantId) return;
    setLoading(true);
    supabase
      .from('client_profiles')
      .select('assistant_name, preferred_language')
      .eq('tenant_id', currentTenantId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setAssistantName((data.assistant_name as string) || 'Temo');
          setLanguage((data.preferred_language as string) || 'en');
        }
        setLoading(false);
      });
  }, [currentTenantId]);

  const save = async () => {
    if (!currentTenantId) return;
    setSaving(true);
    await supabase.from('client_profiles').upsert({
      tenant_id: currentTenantId,
      assistant_name: assistantName.trim() || 'Temo',
      preferred_language: language,
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading workspace...</div>;
  }

  return (
    <div>
      <h2 className="font-grotesk text-lg font-semibold">Workspace &amp; Language</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Customize how Temo presents itself to this workspace ({currentTenant?.name ?? 'Unknown workspace'}).
        The organizational role stays &ldquo;Chief AI Executive&rdquo; — only the display name and response language change.
      </p>

      <div className="mt-6 max-w-md space-y-4">
        <div>
          <Label htmlFor="assistant-name" className="text-xs text-slate-400">Assistant / CEO display name</Label>
          <Input id="assistant-name" value={assistantName} onChange={(e) => setAssistantName(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label htmlFor="language" className="text-xs text-slate-400">Response language</Label>
          <select
            id="language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="mt-1 w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm text-[#e7f6ff] outline-none"
          >
            <option value="en">English</option>
            <option value="ar">Arabic (&#1627;&#1633;&#1633;&#1642; &#1633;&#1633;&#1633;&#1633;&#1633;&#1633;&#1633;)</option>
          </select>
          <p className="mt-1 text-[11px] text-muted-foreground">
            More languages can be added later — this list is not hardcoded into business logic (see docs/TEMO-ARCHITECTURE.md).
          </p>
        </div>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : saved ? <Check className="mr-1.5 h-4 w-4" /> : <Save className="mr-1.5 h-4 w-4" />}
          {saved ? 'Saved' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

function ApprovalsSection() {
  const currentTenantId = useAuthStore((s) => s.currentTenantId);
  const [approvals, setApprovals] = useState<Array<{ id: string; title: string; detail: string; type: string; createdAt: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { listPendingApprovals } = await import('@/lib/governance/approvals');
    const rows = await listPendingApprovals(currentTenantId ?? undefined);
    setApprovals(rows.map((r) => ({ id: r.id, title: r.title, detail: r.detail, type: r.type, createdAt: r.createdAt })));
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [currentTenantId]);

  const resolve = async (id: string, decision: 'approved' | 'rejected') => {
    setResolvingId(id);
    const { resolveApproval } = await import('@/lib/governance/approvals');
    await resolveApproval(id, decision, 'owner');
    await load();
    setResolvingId(null);
  };

  return (
    <div>
      <h2 className="font-grotesk text-lg font-semibold">Approvals</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Actions that can delete data, spend significant money, publish content, or otherwise cannot be undone wait here for
        human sign-off before they run.
      </p>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>
      ) : approvals.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">Nothing pending approval right now.</p>
      ) : (
        <div className="mt-6 space-y-2">
          {approvals.map((a) => (
            <div key={a.id} className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{a.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{a.detail}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-wider text-amber-500/70">{a.type}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="destructive" disabled={resolvingId === a.id} onClick={() => resolve(a.id, 'rejected')}>
                    <XIcon className="mr-1 h-3.5 w-3.5" /> Reject
                  </Button>
                  <Button size="sm" disabled={resolvingId === a.id} onClick={() => resolve(a.id, 'approved')}>
                    <Check className="mr-1 h-3.5 w-3.5" /> Approve
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface AgentRow {
  id: string;
  displayName: string;
  role: string;
  level: 'chief' | 'manager' | 'worker';
  departmentId: string | null;
  parentId: string | null;
  childrenIds: string[];
  isActive: boolean;
  avatar: string;
  avatarUrl: string | null;
  capabilities: string[];
  tools: string[];
  systemPromptTemplate: string;
  permissions: Record<string, boolean | undefined>;
}

const PERMISSION_LABELS: Record<string, string> = {
  canRouteTasks: 'Can route tasks',
  canAccessMemory: 'Can access memory',
  canExecuteWorkflows: 'Can execute workflows',
  canManageAgents: 'Can manage agents',
  canManageWorkers: 'Can manage workers',
};

interface DepartmentOption {
  id: string;
  name: string;
}

function AgentsSection() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newAgent, setNewAgent] = useState({
    id: '',
    displayName: '',
    role: '',
    level: 'worker' as 'manager' | 'worker',
    departmentId: '',
    parentId: '',
  });
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetId = useRef<string | null>(null);
  const [configuringId, setConfiguringId] = useState<string | null>(null);
  const [configDraft, setConfigDraft] = useState<{
    capabilities: string;
    tools: string;
    systemPromptTemplate: string;
    permissions: Record<string, boolean | undefined>;
  }>({ capabilities: '', tools: '', systemPromptTemplate: '', permissions: {} });
  const [savingConfig, setSavingConfig] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [regRes, deptRes] = await Promise.all([
        authFetch('/api/agents/registry').then((r) => r.json()),
        authFetch('/api/agents/departments').then((r) => r.json()),
      ]);
      if (regRes.success) {
        setAgents(regRes.data.agents as AgentRow[]);
      } else {
        setError(regRes.error?.message ?? 'Failed to load agents');
      }
      if (deptRes.success) {
        setDepartments((deptRes.data as { id: string; name: string }[]).map((d) => ({ id: d.id, name: d.name })));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const managers = agents.filter((a) => a.level === 'manager' && a.isActive);

  const startRename = (agent: AgentRow) => {
    setRenamingId(agent.id);
    setRenameValue(agent.displayName);
  };

  const submitRename = async (id: string) => {
    if (!renameValue.trim()) return;
    const res = await authFetch(`/api/agents/registry/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: renameValue.trim() }),
    });
    const json = await res.json();
    if (json.success) {
      toast({ title: 'Agent renamed' });
      setRenamingId(null);
      load();
      useDashboardStore.getState().loadAgents();
    } else {
      toast({ title: 'Rename failed', description: json.error?.message, variant: 'destructive' });
    }
  };

  const submitDelete = async (id: string) => {
    setConfirmDeleteId(null);
    const res = await authFetch(`/api/agents/registry/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      toast({ title: 'Agent deleted' });
      load();
      useDashboardStore.getState().loadAgents();
    } else {
      toast({ title: 'Delete failed', description: json.error?.message, variant: 'destructive' });
    }
  };

  const submitCreate = async () => {
    if (!newAgent.id.trim() || !newAgent.displayName.trim() || !newAgent.role.trim()) {
      toast({ title: 'Missing fields', description: 'ID, display name, and job title are required.', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await authFetch('/api/agents/registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newAgent.id.trim(),
          displayName: newAgent.displayName.trim(),
          role: newAgent.role.trim(),
          level: newAgent.level,
          departmentId: newAgent.departmentId || undefined,
          parentId: newAgent.parentId || undefined,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast({ title: 'Agent created' });
        setShowAddForm(false);
        setNewAgent({ id: '', displayName: '', role: '', level: 'worker', departmentId: '', parentId: '' });
        load();
        useDashboardStore.getState().loadAgents();
      } else {
        toast({ title: 'Create failed', description: json.error?.message, variant: 'destructive' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const startConfigure = (agent: AgentRow) => {
    setConfiguringId(agent.id);
    setConfigDraft({
      capabilities: agent.capabilities.join(', '),
      tools: agent.tools.join(', '),
      systemPromptTemplate: agent.systemPromptTemplate ?? '',
      permissions: { ...agent.permissions },
    });
  };

  const submitConfigure = async (id: string) => {
    setSavingConfig(true);
    try {
      const res = await authFetch(`/api/agents/registry/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capabilities: configDraft.capabilities.split(',').map((s) => s.trim()).filter(Boolean),
          tools: configDraft.tools.split(',').map((s) => s.trim()).filter(Boolean),
          systemPromptTemplate: configDraft.systemPromptTemplate,
          permissions: configDraft.permissions,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast({ title: 'Agent configuration saved' });
        setConfiguringId(null);
        load();
        useDashboardStore.getState().loadAgents();
      } else {
        toast({ title: 'Save failed', description: json.error?.message, variant: 'destructive' });
      }
    } finally {
      setSavingConfig(false);
    }
  };

  const triggerAvatarUpload = (agentId: string) => {
    uploadTargetId.current = agentId;
    avatarInputRef.current?.click();
  };

  const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const agentId = uploadTargetId.current;
    e.target.value = '';
    if (!file || !agentId) return;

    if (!file.type.startsWith('image/')) {
      toast({ title: 'Invalid file', description: 'Please choose an image file.', variant: 'destructive' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'Image too large', description: 'Choose an image under 5MB.', variant: 'destructive' });
      return;
    }

    setUploadingId(agentId);
    try {
      const ext = file.name.split('.').pop() || 'png';
      // Cache-busting path (not filename reuse + upsert) — a stable path
      // would keep serving the old cached image from CDNs/browsers after
      // a re-upload, since the URL itself wouldn't change.
      const path = `${agentId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('agent-avatars').upload(path, file, {
        cacheControl: '3600',
        upsert: false,
      });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from('agent-avatars').getPublicUrl(path);
      const avatarUrl = publicUrlData.publicUrl;

      const res = await authFetch(`/api/agents/registry/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarUrl }),
      });
      const json = await res.json();
      if (json.success) {
        toast({ title: 'Agent image updated' });
        load();
        useDashboardStore.getState().loadAgents();
      } else {
        toast({ title: 'Failed to save image', description: json.error?.message, variant: 'destructive' });
      }
    } catch (err) {
      toast({ title: 'Upload failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setUploadingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading agents...
      </div>
    );
  }

  return (
    <div>
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleAvatarFileChange}
      />
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-grotesk text-lg font-semibold">Agent Management</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Rename agents or add/remove workers. Job titles are system-controlled and cannot be
            edited — only the display name can change.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowAddForm((s) => !s)}>
          <UserPlus className="mr-1.5 h-4 w-4" />
          Add Agent
        </Button>
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      {showAddForm && (
        <div className="mt-4 space-y-3 rounded-xl border border-border/60 p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Agent ID (unique, immutable)</label>
              <input
                value={newAgent.id}
                onChange={(e) => setNewAgent((s) => ({ ...s, id: e.target.value.trim().toLowerCase().replace(/\s+/g, '-') }))}
                placeholder="e.g. nova-devops"
                className="mt-1 w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm text-[#e7f6ff] outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Display name</label>
              <input
                value={newAgent.displayName}
                onChange={(e) => setNewAgent((s) => ({ ...s, displayName: e.target.value }))}
                placeholder="e.g. DevOps Engineer"
                className="mt-1 w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm text-[#e7f6ff] outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Job title (fixed once created)</label>
              <input
                value={newAgent.role}
                onChange={(e) => setNewAgent((s) => ({ ...s, role: e.target.value }))}
                placeholder="e.g. DevOps Engineer"
                className="mt-1 w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm text-[#e7f6ff] outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Level</label>
              <select
                value={newAgent.level}
                onChange={(e) => setNewAgent((s) => ({ ...s, level: e.target.value as 'manager' | 'worker', parentId: '' }))}
                className="mt-1 w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm text-[#e7f6ff] outline-none"
              >
                <option value="worker">Worker (reports to a manager)</option>
                <option value="manager">Manager (reports to Temo)</option>
              </select>
            </div>
            {newAgent.level === 'worker' && (
              <div>
                <label className="text-xs text-muted-foreground">Reports to (manager)</label>
                <select
                  value={newAgent.parentId}
                  onChange={(e) => setNewAgent((s) => ({ ...s, parentId: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm text-[#e7f6ff] outline-none"
                >
                  <option value="">Select a manager...</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>{m.displayName}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground">Department</label>
              <select
                value={newAgent.departmentId}
                onChange={(e) => setNewAgent((s) => ({ ...s, departmentId: e.target.value }))}
                className="mt-1 w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm text-[#e7f6ff] outline-none"
              >
                <option value="">Inherit from manager</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            You can add a profile image right after creating the agent — click its avatar circle below.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={submitCreate} disabled={submitting}>
              {submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
              Create Agent
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="mt-6 space-y-2">
        {agents.map((agent) => (
          <div key={agent.id} className="rounded-xl border border-border/40">
          <div
            className="flex items-center justify-between gap-4 px-4 py-3"
          >
            <button
              type="button"
              onClick={() => triggerAvatarUpload(agent.id)}
              disabled={uploadingId === agent.id}
              title={`Change ${agent.displayName}'s image`}
              className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-border/60 bg-white/5 transition-opacity hover:opacity-80"
            >
              {agent.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL
                <img src={agent.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs font-semibold uppercase text-muted-foreground">
                  {agent.displayName.slice(0, 2)}
                </div>
              )}
              {uploadingId === agent.id && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <Loader2 className="h-4 w-4 animate-spin text-white" />
                </div>
              )}
            </button>
            <div className="min-w-0 flex-1">
              {renamingId === agent.id ? (
                <div className="flex items-center gap-2">
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="rounded-md border border-border/60 bg-background px-2 py-1 text-sm text-[#e7f6ff] outline-none"
                    autoFocus
                  />
                  <Button size="sm" onClick={() => submitRename(agent.id)}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setRenamingId(null)}>Cancel</Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{agent.displayName}</span>
                  <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {agent.level}
                  </span>
                </div>
              )}
              <p className="mt-0.5 text-xs text-muted-foreground">{agent.role} &middot; job title fixed</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => (configuringId === agent.id ? setConfiguringId(null) : startConfigure(agent))}
                aria-label={`Configure ${agent.displayName}`}
                title="Capabilities, tools, permissions, system prompt"
              >
                <SettingsIcon className="h-4 w-4" />
              </Button>
              {agent.id !== 'temo' && renamingId !== agent.id && (
                <Button size="sm" variant="ghost" onClick={() => startRename(agent)} aria-label={`Rename ${agent.displayName}`}>
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
              {agent.id !== 'temo' && confirmDeleteId !== agent.id && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmDeleteId(agent.id)}
                  disabled={agent.childrenIds.length > 0}
                  title={agent.childrenIds.length > 0 ? 'Cannot delete — this agent has workers assigned' : 'Delete agent'}
                  aria-label={`Delete ${agent.displayName}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
              {confirmDeleteId === agent.id && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-400">Delete permanently?</span>
                  <Button size="sm" variant="destructive" onClick={() => submitDelete(agent.id)}>Confirm</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
                </div>
              )}
            </div>
          </div>
          {configuringId === agent.id && (
            <div className="space-y-3 border-t border-border/40 px-4 py-3">
              <div>
                <label className="text-xs text-muted-foreground">Capabilities (comma-separated)</label>
                <input
                  value={configDraft.capabilities}
                  onChange={(e) => setConfigDraft((s) => ({ ...s, capabilities: e.target.value }))}
                  placeholder="e.g. code-review, deployment, testing"
                  className="mt-1 w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm text-[#e7f6ff] outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Tools (comma-separated tool IDs)</label>
                <input
                  value={configDraft.tools}
                  onChange={(e) => setConfigDraft((s) => ({ ...s, tools: e.target.value }))}
                  placeholder="e.g. n8n.triggerWorkflow, web.search"
                  className="mt-1 w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm text-[#e7f6ff] outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">System prompt template</label>
                <textarea
                  value={configDraft.systemPromptTemplate}
                  onChange={(e) => setConfigDraft((s) => ({ ...s, systemPromptTemplate: e.target.value }))}
                  rows={3}
                  placeholder="Overrides this agent's default system prompt when set"
                  className="mt-1 w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm text-[#e7f6ff] outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Permissions</label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {Object.entries(PERMISSION_LABELS).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 text-xs text-[#e7f6ff]">
                      <input
                        type="checkbox"
                        checked={!!configDraft.permissions[key]}
                        onChange={(e) =>
                          setConfigDraft((s) => ({ ...s, permissions: { ...s.permissions, [key]: e.target.checked } }))
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => submitConfigure(agent.id)} disabled={savingConfig}>
                  {savingConfig ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfiguringId(null)}>Cancel</Button>
              </div>
            </div>
          )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProvidersSection({
  providers,
  currentId,
  onSelect,
}: {
  providers: ReturnType<typeof useDashboardStore.getState>['providers'];
  currentId: string;
  onSelect: (id: string) => void;
}) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({ gemini: false, groq: false, nvidia: false, openrouter: false, ollama: false });
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({ gemini: '', groq: '', nvidia: '', openrouter: '', ollama: '' });
  const [ollamaUrl, setOllamaUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  type ProviderValidationState = {
    status: ProviderValidationStatus | 'idle' | 'validating';
    message?: string;
    models: ModelInfo[];
    validatedAt?: number;
    stale?: boolean;
  };
  const emptyValidation = (): ProviderValidationState => ({ status: 'idle', models: [] });
  const [validation, setValidation] = useState<Record<ProviderId, ProviderValidationState>>({
    gemini: emptyValidation(), groq: emptyValidation(), nvidia: emptyValidation(),
    openrouter: emptyValidation(), ollama: emptyValidation(),
  });
  // Tracks the in-flight validation request per provider so a newer click
  // (or the input changing underneath it) can cancel a stale one instead of
  // letting two responses race to update the same card.
  const validateAbortRef = useRef<Partial<Record<ProviderId, AbortController>>>({});

  // Cached discovery results load immediately on mount — no network call —
  // so the model dropdown isn't empty/static on every page visit. Only a
  // real Validate click ever triggers a fresh provider request.
  useEffect(() => {
    const cached: Partial<Record<ProviderId, ProviderValidationState>> = {};
    (['gemini', 'groq', 'nvidia', 'openrouter', 'ollama'] as ProviderId[]).forEach((pid) => {
      const entry = loadCachedValidation(pid);
      if (entry) {
        cached[pid] = { status: entry.status, message: entry.message, models: entry.models, validatedAt: entry.validatedAt, stale: entry.stale };
      }
    });
    if (Object.keys(cached).length > 0) {
      setValidation((v) => ({ ...v, ...cached }));
    }
  }, []);

  const cancelValidation = (pid: ProviderId) => {
    validateAbortRef.current[pid]?.abort();
    delete validateAbortRef.current[pid];
  };

  const handleValidate = async (pid: ProviderId) => {
    cancelValidation(pid); // supersede any still-running validation for this provider
    const controller = new AbortController();
    validateAbortRef.current[pid] = controller;

    setValidation((v) => ({ ...v, [pid]: { ...v[pid], status: 'validating' } }));

    const rawKey = keyInputs[pid];
    // A value still showing the masked dots means "unchanged" — validate
    // the already-saved key server-side rather than sending mask characters.
    const apiKey = rawKey && !rawKey.includes('•') ? rawKey : undefined;
    const requestBody: Record<string, unknown> = { provider: pid };
    if (apiKey !== undefined) requestBody.apiKey = apiKey;
    if (pid === 'ollama') requestBody.baseUrl = ollamaUrl || undefined;

    try {
      const res = await authFetch('/api/settings/validate-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      const envelope = await res.json().catch(() => null);
      const result: ProviderValidationResult | null = envelope?.data ?? null;
      if (!result) {
        setValidation((v) => ({ ...v, [pid]: { status: 'unknown_error', message: envelope?.error?.message ?? 'Validation service returned an unexpected response.', models: v[pid].models } }));
        return;
      }
      const models = result.models ?? [];
      setValidation((v) => ({
        ...v,
        [pid]: {
          status: result.status,
          message: result.message,
          models: models.length > 0 ? models : v[pid].models,
          validatedAt: Date.now(),
          stale: false,
        },
      }));
      if (models.length > 0) {
        saveCachedValidation(pid, { status: result.status, message: result.message, models });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return; // superseded — a newer click already took over
      setValidation((v) => ({ ...v, [pid]: { ...v[pid], status: 'unknown_error', message: 'Could not reach the validation service.' } }));
    } finally {
      if (validateAbortRef.current[pid] === controller) delete validateAbortRef.current[pid];
    }
  };

  useEffect(() => {
    // React 18 Strict Mode double-invokes effects in dev (mount → cleanup →
    // mount), which was firing this load twice back to back — harmless for
    // an idempotent GET, but the ignore-flag is the correct, documented
    // pattern regardless: it also prevents setting state from a stale
    // response if this component unmounts before the fetch resolves.
    let ignore = false;
    void loadSettings()
      .then((s) => {
        if (ignore) return;
        setSettings(s);
        setKeyInputs({
          gemini: s.gemini_api_key ? '••••••••••••••••' : '',
          groq: s.groq_api_key ? '••••••••••••••••' : '',
          nvidia: s.nvidia_api_key ? '••••••••••••••••' : '',
          openrouter: s.openrouter_api_key ? '••••••••••••••••' : '',
          ollama: s.ollama_api_key ? '••••••••••••••••' : '',
        });
        setOllamaUrl(s.ollama_base_url ?? '');
      })
      .catch((e) => { if (!ignore) setError(e.message); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, []);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const patch: Partial<AppSettings> = {
        active_provider: settings.active_provider,
        gemini_model: settings.gemini_model,
        groq_model: settings.groq_model,
        nvidia_model: settings.nvidia_model,
        openrouter_model: settings.openrouter_model,
        ollama_model: settings.ollama_model,
        temperature: settings.temperature,
        max_tokens: settings.max_tokens,
        routing_mode: settings.routing_mode,
        routing_strategy: settings.routing_strategy,
        routing_preferences: settings.routing_preferences,
      };
      if (ollamaUrl !== (settings.ollama_base_url ?? '')) patch.ollama_base_url = ollamaUrl || null;
      // Only update keys that the user actually changed (not the masked dots)
      if (keyInputs.gemini && !keyInputs.gemini.includes('•')) patch.gemini_api_key = keyInputs.gemini;
      if (keyInputs.groq && !keyInputs.groq.includes('•')) patch.groq_api_key = keyInputs.groq;
      if (keyInputs.nvidia && !keyInputs.nvidia.includes('•')) patch.nvidia_api_key = keyInputs.nvidia;
      if (keyInputs.openrouter && !keyInputs.openrouter.includes('•')) patch.openrouter_api_key = keyInputs.openrouter;
      if (keyInputs.ollama && !keyInputs.ollama.includes('•')) patch.ollama_api_key = keyInputs.ollama;

      const updated = await saveSettings(patch);
      setSettings(updated);
      setKeyInputs({
        gemini: updated.gemini_api_key ? '••••••••••••••••' : '',
        groq: updated.groq_api_key ? '••••••••••••••••' : '',
        nvidia: updated.nvidia_api_key ? '••••••••••••••••' : '',
        openrouter: updated.openrouter_api_key ? '••••••••••••••••' : '',
        ollama: updated.ollama_api_key ? '••••••••••••••••' : '',
      });
      setOllamaUrl(updated.ollama_base_url ?? '');
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-8 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading configuration...
      </div>
    );
  }

  if (!settings) {
    return <div className="py-8 text-sm text-destructive">Failed to load settings.</div>;
  }

  const providerIds: ProviderId[] = ['gemini', 'groq', 'nvidia', 'openrouter', 'ollama'];
  const modelFieldMap: Record<ProviderId, keyof AppSettings> = PROVIDER_MODEL_FIELD;
  const isOllama = (pid: ProviderId) => pid === 'ollama';

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-grotesk text-lg font-semibold">AI Providers</h2>
          <p className="mt-1 text-sm text-muted-foreground">Configure API keys, models, and generation parameters</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className={cn(
            'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all',
            savedFlash
              ? 'bg-success/20 text-success'
              : 'bg-primary/20 text-primary hover:bg-primary/30',
            saving && 'opacity-60'
          )}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : savedFlash ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {savedFlash ? 'Saved' : 'Save Changes'}
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Active provider selector */}
      <div className="mt-5">
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active Provider</label>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {providerIds.map((pid) => (
            <button
              key={pid}
              onClick={() => {
                setSettings({ ...settings, active_provider: pid });
                onSelect(pid);
              }}
              className={cn(
                'rounded-xl border p-3 text-center transition-all',
                settings.active_provider === pid
                  ? 'border-primary/40 bg-primary/10'
                  : 'border-border/40 bg-white/[0.02] hover:border-primary/30'
              )}
            >
              <div className="text-sm font-semibold">{PROVIDER_LABELS[pid]}</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {isOllama(pid) ? (ollamaUrl ? 'Configured' : 'No URL') : (keyInputs[pid] ? 'Key set' : 'No key')}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* AI Routing — configures lib/ai/router, not a second provider config */}
      <div className="mt-5 rounded-xl border border-border/40 bg-white/[0.015] p-3">
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">AI Routing</label>
        <p className="mt-1 text-[11px] text-muted-foreground">
          When Automatic, Temo picks the best validated model for each request (chat, mission task, voice turn) based on task type, cost, speed, and reliability — instead of always using the Active Provider above. Manual pins that choice to what you select here.
        </p>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          {(['automatic', 'manual'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setSettings({ ...settings, routing_mode: mode })}
              className={cn(
                'rounded-lg border px-3 py-2 text-center text-sm font-medium capitalize transition-all',
                settings.routing_mode === mode
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border/40 bg-white/[0.02] text-muted-foreground hover:border-primary/30',
              )}
            >
              {mode}
            </button>
          ))}
        </div>
        {settings.routing_mode === 'automatic' && (
          <div className="mt-3">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Strategy</label>
            <div className="mt-1.5 grid grid-cols-5 gap-1.5">
              {(['balanced', 'speed', 'quality', 'cost', 'free_only'] as const).map((strategy) => (
                <button
                  key={strategy}
                  onClick={() => setSettings({ ...settings, routing_strategy: strategy })}
                  className={cn(
                    'rounded-lg border px-2 py-1.5 text-center text-[11px] font-medium capitalize transition-all',
                    settings.routing_strategy === strategy
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border/40 bg-white/[0.02] text-muted-foreground hover:border-primary/30',
                  )}
                >
                  {strategy.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>
        )}
        {settings.routing_mode === 'manual' && (
          <div className="mt-3 space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Preferred provider &amp; model per task type
            </label>
            <p className="text-[11px] text-muted-foreground">
              Pins a provider/model for that task type. The hard budget gate still overrides this if honoring it would exceed the configured budget — it never bypasses budget governance. Leave a task type unset to let Temo pick automatically for it.
            </p>
            <div className="mt-1.5 space-y-1.5">
              {ROUTING_TASK_TYPES.map((taskType) => {
                const pref = settings.routing_preferences[taskType] ?? {};
                const prefProvider = pref.provider;
                const modelsForProvider = prefProvider
                  ? (validation[prefProvider].models.length > 0
                      ? validation[prefProvider].models.map((m) => m.id)
                      : PROVIDER_MODELS[prefProvider])
                  : [];
                return (
                  <div key={taskType} className="grid grid-cols-[1fr_1fr_1fr] items-center gap-2 rounded-lg border border-border/40 bg-white/[0.02] p-2">
                    <span className="text-[11px] font-medium text-muted-foreground">{taskType.replace(/_/g, ' ')}</span>
                    <Select
                      value={prefProvider ?? 'auto'}
                      onValueChange={(v) => setSettings({
                        ...settings,
                        routing_preferences: {
                          ...settings.routing_preferences,
                          [taskType]: v === 'auto' ? {} : { provider: v as ProviderId, model: undefined },
                        },
                      })}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto</SelectItem>
                        {providerIds.map((pid) => <SelectItem key={pid} value={pid}>{PROVIDER_LABELS[pid]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select
                      value={pref.model ?? ''}
                      disabled={!prefProvider}
                      onValueChange={(v) => setSettings({
                        ...settings,
                        routing_preferences: {
                          ...settings.routing_preferences,
                          [taskType]: { provider: prefProvider, model: v },
                        },
                      })}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Model" /></SelectTrigger>
                      <SelectContent>
                        {modelsForProvider.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* API Keys */}
      <div className="mt-5 space-y-4">
        {providerIds.map((pid) => {
          const v = validation[pid];
          const meta = VALIDATION_STATUS_META[v.status];
          const isValidating = v.status === 'validating';
          const discovered = v.models;
          const currentModel = String(settings[modelFieldMap[pid]] ?? '');
          // Union discovered models with the static fallback list AND the
          // currently-configured model, so switching providers/keys never
          // silently drops the production model out of the dropdown (mission
          // Section 12 — never auto-replace a configured model, only inform).
          const optionIds = new Set<string>([
            ...discovered.map((m) => m.id),
            ...(discovered.length === 0 ? PROVIDER_MODELS[pid] : []),
            currentModel,
          ].filter(Boolean));
          const modelOptions: ModelInfo[] = Array.from(optionIds).map(
            (id) => discovered.find((m) => m.id === id) ?? { id },
          );
          const selectedModelInfo = discovered.find((m) => m.id === currentModel);
          const currentModelKnownStale = discovered.length > 0 && !discovered.some((m) => m.id === currentModel);

          return (
            <div key={pid} className="rounded-xl border border-border/40 bg-white/[0.015] p-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {PROVIDER_LABELS[pid]} API Key
                </label>
                <span className={cn('flex items-center gap-1 text-[11px] font-medium', meta.className)}>
                  {isValidating && <Loader2 className="h-3 w-3 animate-spin" />}
                  {v.status === 'connected' && <CheckCircle2 className="h-3 w-3" />}
                  {(v.status === 'invalid_api_key' || v.status === 'unauthorized' || v.status === 'provider_unavailable' || v.status === 'configuration_error' || v.status === 'unknown_error') && <XCircle className="h-3 w-3" />}
                  {(v.status === 'rate_limited' || v.status === 'provider_timeout' || v.status === 'unsupported') && <AlertTriangle className="h-3 w-3" />}
                  {meta.label}
                  {v.stale && v.status !== 'validating' && <span className="text-muted-foreground">(cached)</span>}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type={showKeys[pid] ? 'text' : 'password'}
                  value={keyInputs[pid]}
                  onChange={(e) => {
                    cancelValidation(pid);
                    setKeyInputs({ ...keyInputs, [pid]: e.target.value });
                  }}
                  placeholder={`Enter ${PROVIDER_LABELS[pid]} API key`}
                  className="flex-1 rounded-lg border border-border/40 bg-white/[0.03] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none"
                />
                <button
                  onClick={() => setShowKeys({ ...showKeys, [pid]: !showKeys[pid] })}
                  className="rounded-lg border border-border/40 bg-white/[0.02] p-2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showKeys[pid] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => handleValidate(pid)}
                  disabled={isValidating}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                    isValidating
                      ? 'cursor-not-allowed border-border/40 bg-white/[0.02] text-muted-foreground'
                      : 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20',
                  )}
                >
                  {isValidating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />}
                  {isValidating ? 'Validating…' : 'Validate'}
                </button>
              </div>
              {v.message && (
                <p className={cn('mt-1.5 text-[11px]', meta.className)}>
                  {v.message}
                  {v.status === 'connected' && discovered.length > 0 && ` — ${discovered.length} model${discovered.length === 1 ? '' : 's'} available`}
                </p>
              )}
              {/* Ollama: configurable base URL (not hardcoded) */}
              {isOllama(pid) && (
                <div className="mt-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Ollama Base URL
                  </label>
                  <input
                    type="text"
                    value={ollamaUrl}
                    onChange={(e) => {
                      cancelValidation(pid);
                      setOllamaUrl(e.target.value);
                    }}
                    placeholder="http://localhost:11434"
                    className="mt-1.5 w-full rounded-lg border border-border/40 bg-white/[0.03] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none"
                  />
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Set to a network-reachable URL. Localhost only works when Ollama runs on the same host as the server.
                  </p>
                </div>
              )}
              {/* Model selector */}
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Model:</span>
                <select
                  value={currentModel}
                  onChange={(e) => {
                    cancelValidation(pid);
                    setSettings({ ...settings, [modelFieldMap[pid]]: e.target.value });
                  }}
                  className="flex-1 rounded-lg border border-border/40 bg-white/[0.03] px-3 py-1.5 text-sm text-foreground focus:border-primary/40 focus:outline-none"
                >
                  {modelOptions.map((m) => (
                    <option key={m.id} value={m.id} className="bg-card text-foreground">
                      {m.displayName ?? m.id}
                    </option>
                  ))}
                </select>
              </div>
              {currentModelKnownStale && (
                <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-400">
                  <AlertTriangle className="h-3 w-3" />
                  &quot;{currentModel}&quot; wasn&apos;t in {PROVIDER_LABELS[pid]}&apos;s last discovered model list — it may be deprecated. Pick a valid alternative above if generation fails.
                </p>
              )}
              {selectedModelInfo && (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                  {formatContextLength(selectedModelInfo.contextLength) && <span>{formatContextLength(selectedModelInfo.contextLength)}</span>}
                  {selectedModelInfo.free === true && <span className="text-success">FREE</span>}
                  {selectedModelInfo.free === false && (
                    <span>
                      PAID
                      {formatPrice(selectedModelInfo.inputPrice) && ` — In: ${formatPrice(selectedModelInfo.inputPrice)}/1M`}
                      {formatPrice(selectedModelInfo.outputPrice) && ` · Out: ${formatPrice(selectedModelInfo.outputPrice)}/1M`}
                    </span>
                  )}
                  {selectedModelInfo.free === null && selectedModelInfo.free !== undefined && <span>Pricing: Unknown</span>}
                </div>
              )}
              {v.validatedAt && (
                <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  Last validated: {new Date(v.validatedAt).toLocaleString()}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Generation parameters */}
      <div className="mt-6">
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Generation Parameters</label>
        <div className="mt-3 space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Temperature</span>
              <span className="text-sm font-medium tabular-nums text-foreground">{settings.temperature.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={settings.temperature}
              onChange={(e) => setSettings({ ...settings, temperature: parseFloat(e.target.value) })}
              className="mt-2 w-full accent-primary"
            />
            <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
              <span>Precise (0)</span>
              <span>Creative (2)</span>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Max Output Tokens</span>
              <span className="text-sm font-medium tabular-nums text-foreground">{settings.max_tokens}</span>
            </div>
            <input
              type="range"
              min={256}
              max={8192}
              step={256}
              value={settings.max_tokens}
              onChange={(e) => setSettings({ ...settings, max_tokens: parseInt(e.target.value) })}
              className="mt-2 w-full accent-primary"
            />
            <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
              <span>256</span>
              <span>8192</span>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-4 text-[11px] text-muted-foreground">
        API keys are stored securely in your project database and only used server-side. They are never exposed to the browser.
      </p>
    </div>
  );
}

function ToggleRow({ label, description, defaultOn, onToggle }: { label: string; description: string; defaultOn: boolean; onToggle?: () => void }) {
  const [on, setOn] = useState(defaultOn);
  const handleToggle = () => {
    setOn(!on);
    onToggle?.();
  };
  return (
    <div className="flex items-center justify-between border-b border-border/40 py-3 last:border-0">
      <div>
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <button
        onClick={handleToggle}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors',
          on ? 'bg-primary/80' : 'bg-white/10'
        )}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow', on ? 'left-[22px]' : 'left-0.5')}
        />
      </button>
    </div>
  );
}

function NotificationsSection() {
  return (
    <div>
      <h2 className="font-grotesk text-lg font-semibold">Notifications</h2>
      <p className="mt-1 text-sm text-muted-foreground">Manage how Temo alerts you</p>
      <div className="mt-4">
        <ToggleRow label="Workflow completions" description="Notify when a workflow finishes" defaultOn={true} />
        <ToggleRow label="Agent status changes" description="Alert on agent state transitions" defaultOn={true} />
        <ToggleRow label="Provider errors" description="Notify on provider failures" defaultOn={true} />
        <ToggleRow label="Daily digest" description="Email a summary each morning" defaultOn={false} />
        <ToggleRow label="Sound effects" description="Play audio on new events" defaultOn={false} />
      </div>
    </div>
  );
}

function AppearanceSection() {
  return (
    <div>
      <h2 className="font-grotesk text-lg font-semibold">Appearance</h2>
      <p className="mt-1 text-sm text-muted-foreground">Customize the look of Temo</p>
      <div className="mt-4">
        <Field label="Theme" value="Dark (locked)" />
        <Field label="Accent color" value="Cyan #00E5FF" />
        <Field label="Font" value="Inter / Space Grotesk" />
        <Field label="Density" value="Comfortable" />
        <Field label="Animations" value="Enabled" />
      </div>
    </div>
  );
}

function PrivacySection() {
  return (
    <div>
      <h2 className="font-grotesk text-lg font-semibold">Privacy &amp; Security</h2>
      <p className="mt-1 text-sm text-muted-foreground">Control your data and access</p>
      <div className="mt-4">
        <ToggleRow label="Local-only transcripts" description="Keep voice transcripts on-device" defaultOn={true} />
        <ToggleRow label="Telemetry" description="Share anonymous usage data" defaultOn={false} />
        <ToggleRow label="Auto-lock" description="Lock workspace after 15 min idle" defaultOn={true} />
        <Field label="Data retention" value="30 days" />
        <Field label="Two-factor auth" value="Enabled" />
      </div>
    </div>
  );
}

function VoiceSection() {
  const settings = useVoiceStore((s) => s.settings);
  const updateSettings = useVoiceStore((s) => s.updateSettings);
  const isMuted = useVoiceStore((s) => s.isMuted);
  const toggleMuted = useVoiceStore((s) => s.toggleMuted);
  const [voices, setVoices] = useState<string[]>([]);

  useEffect(() => {
    const load = () => {
      const v = voiceManager.getAvailableVoices().map((v) => v.name);
      if (v.length > 0) setVoices(v);
      else setVoices(['Aurora', 'Nova', 'Echo', 'Pulse']);
    };
    load();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = load;
    }
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  const langs: { value: VoiceLanguage; label: string }[] = [
    { value: 'en-US', label: 'English (US)' },
    { value: 'en-GB', label: 'English (UK)' },
    { value: 'es-ES', label: 'Spanish' },
    { value: 'fr-FR', label: 'French' },
    { value: 'de-DE', label: 'German' },
    { value: 'ja-JP', label: 'Japanese' },
    { value: 'ar-EG', label: 'Arabic (Egyptian)' },
    { value: 'ar-SA', label: 'Arabic (Standard)' },
    { value: 'zh-CN', label: 'Chinese' },
  ];

  return (
    <div>
      <h2 className="font-grotesk text-lg font-semibold">Voice</h2>
      <p className="mt-1 text-sm text-muted-foreground">Configure the voice pipeline</p>
      <div className="mt-4 space-y-1">
        <SelectRow
          label="Engine"
          value="Gemini Live API"
          options={['Gemini Live API']}
          onChange={() => {}}
        />
        <SelectRow
          label="Voice"
          value={settings.selectedVoice}
          options={voices}
          onChange={(v) => updateSettings({ selectedVoice: v })}
        />
        <SelectRow
          label="Language"
          value={langs.find((l) => l.value === settings.language)?.label ?? 'English (US)'}
          options={langs.map((l) => l.label)}
          onChange={(label) => {
            const lang = langs.find((l) => l.label === label);
            if (lang) updateSettings({ language: lang.value });
          }}
        />
        <SliderRow
          label="Speed"
          value={settings.speed}
          min={0.5}
          max={2}
          step={0.1}
          format={(v) => `${v.toFixed(1)}x`}
          onChange={(v) => updateSettings({ speed: v })}
        />
        <SliderRow
          label="Pitch"
          value={settings.pitch}
          min={0}
          max={2}
          step={0.1}
          format={(v) => v.toFixed(1)}
          onChange={(v) => updateSettings({ pitch: v })}
        />
        <SliderRow
          label="Volume"
          value={settings.volume}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => updateSettings({ volume: v })}
        />
      </div>
      <div className="mt-4">
        <ToggleRow
          label="Muted"
          description="Silence all voice output"
          defaultOn={isMuted}
          key={`mute-${isMuted}`}
          onToggle={toggleMuted}
        />
        <ToggleRow
          label="Wake word"
          description='Listen for "Hey Temo"'
          defaultOn={settings.wakeWordEnabled}
          key={`wake-${settings.wakeWordEnabled}`}
          onToggle={() => updateSettings({ wakeWordEnabled: !settings.wakeWordEnabled })}
        />
        <ToggleRow
          label="Push to talk"
          description="Hold spacebar to speak"
          defaultOn={settings.pushToTalk}
          key={`ptt-${settings.pushToTalk}`}
          onToggle={() => updateSettings({ pushToTalk: !settings.pushToTalk })}
        />
        <ToggleRow
          label="Auto-transcribe"
          description="Transcribe all voice sessions"
          defaultOn={settings.autoTranscribe}
          key={`auto-${settings.autoTranscribe}`}
          onToggle={() => updateSettings({ autoTranscribe: !settings.autoTranscribe })}
        />
      </div>
    </div>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border/40 py-3 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-border/40 bg-white/[0.03] px-3 py-1.5 text-sm text-foreground focus:border-primary/40 focus:outline-none"
      >
        {options.map((o) => (
          <option key={o} value={o} className="bg-card text-foreground">
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="border-b border-border/40 py-3 last:border-0">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-sm font-medium tabular-nums text-foreground">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="mt-2 w-full accent-primary"
      />
    </div>
  );
}

function N8nSection() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSettings().then(setSettings).catch(() => setError('Failed to load settings'));
  }, []);

  if (!settings) return <div className="py-8 text-center text-sm text-muted-foreground">Loading...</div>;

  const update = (patch: Partial<AppSettings>) => {
    setSettings({ ...settings, ...patch });
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveSettings({
        n8n_url: settings.n8n_url,
        n8n_api_key: settings.n8n_api_key,
        n8n_timeout: settings.n8n_timeout,
        n8n_retry_count: settings.n8n_retry_count,
        n8n_ssl_verify: settings.n8n_ssl_verify,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      await saveSettings({
        n8n_url: settings.n8n_url,
        n8n_api_key: settings.n8n_api_key,
        n8n_timeout: settings.n8n_timeout,
        n8n_retry_count: settings.n8n_retry_count,
        n8n_ssl_verify: settings.n8n_ssl_verify,
      });
      const result = await testConnection();
      setTestResult(result);
    } catch (err) {
      setTestResult({
        connected: false,
        version: null,
        latency: 0,
        authStatus: 'unknown',
        error: err instanceof Error ? err.message : 'Connection test failed',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-grotesk text-lg font-semibold">n8n Integration</h2>
        <p className="text-sm text-muted-foreground">Connect Temo to your n8n automation server. All communication goes through a secure proxy — your API key never leaves the server.</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Server URL */}
      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">n8n Server URL</label>
        <input
          type="text"
          value={settings.n8n_url ?? ''}
          onChange={(e) => update({ n8n_url: e.target.value })}
          placeholder="http://localhost:5678"
          className="mt-1.5 w-full rounded-lg border border-border/40 bg-white/[0.03] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none"
        />
      </div>

      {/* API Key */}
      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">API Key</label>
        <div className="mt-1.5 flex gap-2">
          <input
            type={showKey ? 'text' : 'password'}
            value={settings.n8n_api_key ?? ''}
            onChange={(e) => update({ n8n_api_key: e.target.value })}
            placeholder="n8n_api_..."
            className="flex-1 rounded-lg border border-border/40 bg-white/[0.03] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none"
          />
          <button
            onClick={() => setShowKey(!showKey)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/40 text-muted-foreground transition-colors hover:text-foreground"
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">Stored server-side only. Never exposed to the browser.</p>
      </div>

      {/* Timeout */}
      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Connection Timeout (ms)</label>
        <input
          type="number"
          value={settings.n8n_timeout}
          onChange={(e) => update({ n8n_timeout: parseInt(e.target.value) || 30000 })}
          min={1000}
          step={1000}
          className="mt-1.5 w-full rounded-lg border border-border/40 bg-white/[0.03] px-3 py-2 text-sm text-foreground focus:border-primary/40 focus:outline-none"
        />
      </div>

      {/* Retry Count */}
      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Retry Count</label>
        <input
          type="number"
          value={settings.n8n_retry_count}
          onChange={(e) => update({ n8n_retry_count: parseInt(e.target.value) || 3 })}
          min={0}
          max={10}
          className="mt-1.5 w-full rounded-lg border border-border/40 bg-white/[0.03] px-3 py-2 text-sm text-foreground focus:border-primary/40 focus:outline-none"
        />
        <p className="mt-1 text-[10px] text-muted-foreground">Retries on timeout or network failure with exponential backoff.</p>
      </div>

      {/* SSL Verify */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium text-foreground">SSL Verification</span>
          <p className="text-[10px] text-muted-foreground">Verify SSL certificates on n8n requests. Disable only for local development with self-signed certs.</p>
        </div>
        <button
          onClick={() => update({ n8n_ssl_verify: !settings.n8n_ssl_verify })}
          className={`relative h-6 w-11 rounded-full transition-colors ${settings.n8n_ssl_verify ? 'bg-primary' : 'bg-white/10'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${settings.n8n_ssl_verify ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>

      {/* Buttons */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={handleTest}
          disabled={testing}
          className="flex items-center gap-2 rounded-lg border border-border/40 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-white/5 disabled:opacity-50"
        >
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
          Test Connection
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-primary to-secondary px-4 py-2 text-sm font-semibold text-background glow-primary disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {saved ? 'Saved' : 'Save Settings'}
        </button>
      </div>

      {/* Connection Test Result */}
      {testResult && (
        <div className={`rounded-xl border p-4 ${testResult.connected ? 'border-success/30 bg-success/5' : 'border-destructive/30 bg-destructive/5'}`}>
          <div className="flex items-center gap-2">
            <span className={`text-lg ${testResult.connected ? 'text-success' : 'text-destructive'}`}>
              {testResult.connected ? '\uD83D\uDFE2' : '\uD83D\uDD34'}
            </span>
            <span className="font-grotesk text-sm font-semibold">
              {testResult.connected ? 'Connected' : 'Connection Failed'}
            </span>
          </div>
          {testResult.error && (
            <p className="mt-2 text-xs text-muted-foreground">{testResult.error}</p>
          )}
          {testResult.connected && (
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-muted-foreground">n8n Version</span>
                <p className="font-medium text-foreground">{testResult.version ?? 'unknown'}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Latency</span>
                <p className="font-medium text-foreground">{testResult.latency} ms</p>
              </div>
              <div>
                <span className="text-muted-foreground">API Available</span>
                <p className="font-medium text-foreground">{testResult.connected ? 'Yes' : 'No'}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Authentication</span>
                <p className="font-medium text-foreground">
                  {testResult.authStatus === 'ok' ? 'Valid' : testResult.authStatus === 'failed' ? 'Failed' : 'Unknown'}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MemorySection() {
  const [settings, setSettings] = useState<MemorySettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [providers] = useState([
    { id: 'gemini', label: 'Google Gemini', models: ['gemini-embedding-001', 'gemini-embedding-2-preview', 'gemini-embedding-2'] },
    { id: 'openrouter', label: 'OpenRouter', models: ['openai/text-embedding-3-small', 'openai/text-embedding-3-large'] },
    { id: 'nvidia', label: 'NVIDIA NIM', models: ['nvidia/nv-embed-v1', 'nvidia/llama-3.2-nv-embedqa-1b-v2'] },
    { id: 'ollama', label: 'Ollama (Local)', models: ['nomic-embed-text', 'all-minilm', 'mxbai-embed-large'] },
  ]);

  useEffect(() => {
    loadMemorySettings().then(setSettings);
  }, []);

  const update = (patch: Partial<MemorySettings>) => {
    setSettings((s) => s ? { ...s, ...patch } : s);
    setSaved(false);
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await saveMemorySettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      toast({ title: 'Error', description: 'Failed to save memory settings', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Memory Engine</h2>
        <p className="text-sm text-muted-foreground">Configure how Temo stores, retrieves, and uses memories.</p>
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border border-border/40 p-4 space-y-4">
          <h3 className="text-sm font-medium">Embedding Provider</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Provider</label>
              <Select value={settings.embedding_provider} onValueChange={(v) => update({ embedding_provider: v, embedding_model: providers.find((p) => p.id === v)?.models[0] ?? '' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {providers.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Model</label>
              <Select value={settings.embedding_model} onValueChange={(v) => update({ embedding_model: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(providers.find((p) => p.id === settings.embedding_provider)?.models ?? []).map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border/40 p-4 space-y-4">
          <h3 className="text-sm font-medium">Retrieval Settings</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Chunk Size: {settings.chunk_size}</label>
              <Slider value={[settings.chunk_size]} min={128} max={2048} step={64} onValueChange={(v) => update({ chunk_size: v[0] })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Chunk Overlap: {settings.chunk_overlap}</label>
              <Slider value={[settings.chunk_overlap]} min={0} max={256} step={16} onValueChange={(v) => update({ chunk_overlap: v[0] })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Top K: {settings.top_k}</label>
              <Slider value={[settings.top_k]} min={1} max={20} step={1} onValueChange={(v) => update({ top_k: v[0] })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Similarity Threshold: {settings.similarity_threshold.toFixed(2)}</label>
              <Slider value={[settings.similarity_threshold]} min={0} max={1} step={0.05} onValueChange={(v) => update({ similarity_threshold: v[0] })} />
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border/40 p-4 space-y-4">
          <h3 className="text-sm font-medium">Automation</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm">Auto Remember</div>
                <div className="text-xs text-muted-foreground">Automatically store important interactions as memories</div>
              </div>
              <Switch checked={settings.auto_remember} onCheckedChange={(v) => update({ auto_remember: v })} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm">Auto Summarize</div>
                <div className="text-xs text-muted-foreground">Generate AI summaries for new memories</div>
              </div>
              <Switch checked={settings.auto_summarize} onCheckedChange={(v) => update({ auto_summarize: v })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Memory Expiration (days): {settings.memory_expiration_days}</label>
              <Slider value={[settings.memory_expiration_days]} min={1} max={365} step={1} onValueChange={(v) => update({ memory_expiration_days: v[0] })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Max Short-Term Items: {settings.max_short_term_items}</label>
              <Slider value={[settings.max_short_term_items]} min={5} max={100} step={5} onValueChange={(v) => update({ max_short_term_items: v[0] })} />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {saving ? 'Saving...' : 'Save Memory Settings'}
          </Button>
          {saved && <span className="text-sm text-success flex items-center gap-1"><Check className="h-4 w-4" /> Saved</span>}
        </div>
      </div>
    </div>
  );
}
