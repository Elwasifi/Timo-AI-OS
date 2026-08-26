// Phase 4 — Product Readiness Service Interfaces
//
// Clean interfaces and service boundaries for future product features.
// These are NOT implemented — they define the contracts that future
// phases will fulfill. The interfaces exist so the architecture is
// ready and the future UI can reference them without backend changes.
//
// Each service is a namespace with typed method signatures.
// Implementations will be added in future phases.

// ---- Settings Service ----

export interface SettingsConfig {
  activeProvider: string;
  temperature: number;
  maxTokens: number;
  autoRemember: boolean;
  voiceEnabled: boolean;
  theme: string;
  language: string;
}

export interface SettingsService {
  get(): Promise<SettingsConfig>;
  update(patch: Partial<SettingsConfig>): Promise<SettingsConfig>;
  reset(): Promise<SettingsConfig>;
  exportConfig(): Promise<Record<string, unknown>>;
  importConfig(config: Record<string, unknown>): Promise<SettingsConfig>;
}

// ---- Installer Service ----

export interface InstallStatus {
  step: string;
  progress: number;
  isComplete: boolean;
  error: string | null;
}

export interface InstallerService {
  checkPrerequisites(): Promise<{ met: boolean; missing: string[] }>;
  startInstall(config: Record<string, unknown>): Promise<InstallStatus>;
  getInstallStatus(): Promise<InstallStatus>;
  cancelInstall(): Promise<void>;
}

// ---- Onboarding Service ----

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  isComplete: boolean;
  isRequired: boolean;
}

export interface OnboardingService {
  getSteps(): Promise<OnboardingStep[]>;
  completeStep(stepId: string): Promise<void>;
  skipStep(stepId: string): Promise<void>;
  getProgress(): Promise<{ completed: number; total: number; percentage: number }>;
  resetOnboarding(): Promise<void>;
}

// ---- Backup Service ----

export interface BackupEntry {
  id: string;
  createdAt: string;
  size: number;
  type: 'full' | 'partial';
  status: 'completed' | 'failed' | 'in_progress';
}

export interface BackupService {
  createBackup(type?: 'full' | 'partial'): Promise<BackupEntry>;
  listBackups(): Promise<BackupEntry[]>;
  restoreBackup(backupId: string): Promise<void>;
  deleteBackup(backupId: string): Promise<void>;
  scheduleBackup(cronExpression: string): Promise<void>;
}

// ---- Update Service ----

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  isUpdateAvailable: boolean;
  changelog: string;
  releaseDate: string;
}

export interface UpdateService {
  checkForUpdates(): Promise<UpdateInfo>;
  downloadUpdate(version: string): Promise<void>;
  applyUpdate(): Promise<void>;
  rollbackUpdate(): Promise<void>;
  getUpdateHistory(): Promise<Array<{ version: string; appliedAt: string }>>;
}

// ---- Error Reporting Service ----

export interface ErrorReport {
  id: string;
  timestamp: string;
  level: 'error' | 'warning' | 'critical';
  message: string;
  stack: string | null;
  context: Record<string, unknown>;
}

export interface ErrorReportingService {
  report(error: Error, context?: Record<string, unknown>): Promise<void>;
  listReports(limit?: number): Promise<ErrorReport[]>;
  clearReports(): Promise<void>;
  setReportingEnabled(enabled: boolean): Promise<void>;
}

// ---- Licensing Service ----

export interface LicenseInfo {
  licenseKey: string | null;
  tier: 'free' | 'pro' | 'enterprise';
  status: 'active' | 'expired' | 'trial' | 'none';
  expiresAt: string | null;
  features: string[];
}

export interface LicensingService {
  getLicense(): Promise<LicenseInfo>;
  activateLicense(key: string): Promise<LicenseInfo>;
  deactivateLicense(): Promise<void>;
  checkEntitlement(feature: string): Promise<boolean>;
  getAvailableFeatures(): Promise<string[]>;
}

// ---- Service Registry (for future dependency injection) ----

export interface ProductServices {
  settings: SettingsService;
  installer: InstallerService;
  onboarding: OnboardingService;
  backup: BackupService;
  update: UpdateService;
  errorReporting: ErrorReportingService;
  licensing: LicensingService;
}

// Placeholder — implementations will be injected in future phases
export const productServiceRegistry: Partial<ProductServices> = {};

export function registerProductService<K extends keyof ProductServices>(
  name: K,
  service: ProductServices[K],
): void {
  productServiceRegistry[name] = service;
}
