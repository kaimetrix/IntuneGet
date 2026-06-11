/**
 * Tests for auto-update trigger psadtConfig handling:
 * per-package PSADT settings must survive app updates (issue follow-up to #96).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutoUpdateTrigger } from '../trigger';
import type { AppUpdatePolicy, DeploymentConfig } from '@/types/update-policies';

interface TableHandlers {
  maybeSingleResult?: { data: unknown; error: unknown };
  singleResult?: { data: unknown; error: unknown };
  updateSpy?: ReturnType<typeof vi.fn>;
  insertSpy?: ReturnType<typeof vi.fn>;
}

function createSupabaseMock(tables: Record<string, TableHandlers>) {
  return {
    from: vi.fn((table: string) => {
      const handlers = tables[table] || {};
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const method of ['select', 'eq', 'not', 'order', 'limit']) {
        builder[method] = vi.fn(chain);
      }
      builder.maybeSingle = vi.fn(async () => handlers.maybeSingleResult || { data: null, error: null });
      builder.single = vi.fn(async () => handlers.singleResult || { data: null, error: null });
      builder.update = vi.fn((payload: unknown) => {
        handlers.updateSpy?.(payload);
        return builder;
      });
      builder.insert = vi.fn((payload: unknown) => {
        handlers.insertSpy?.(payload);
        return builder;
      });
      return builder;
    }),
  };
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({})),
}));

const PSADT_CONFIG = {
  deployMode: 'Silent',
  verifyInstall: true,
  removeExistingInstall: true,
  registryMarkerPath: 'SOFTWARE\\Contoso\\Apps',
  installCommand: 'msiexec /i "setup.msi" /qn',
};

function makePolicy(deploymentConfig: Partial<DeploymentConfig>): AppUpdatePolicy {
  return {
    id: 'policy-1',
    user_id: 'user-1',
    tenant_id: 'tenant-1',
    winget_id: 'Test.App',
    policy_type: 'auto_update',
    deployment_config: deploymentConfig as DeploymentConfig,
    is_enabled: true,
  } as unknown as AppUpdatePolicy;
}

const UPDATE_INFO = {
  wingetId: 'Test.App',
  currentVersion: '1.0.0',
  latestVersion: '2.0.0',
  displayName: 'Test App',
  installerUrl: 'https://example.com/setup-2.0.0.zip',
  installerSha256: 'abc',
  installerType: 'zip',
  nestedInstallerType: 'exe',
  nestedInstallerPath: 'setup-2.0.0.exe',
};

function makeTrigger(supabaseMock: ReturnType<typeof createSupabaseMock>): AutoUpdateTrigger {
  const trigger = new AutoUpdateTrigger('https://stub.supabase.co', 'stub-key');
  (trigger as unknown as { supabase: unknown }).supabase = supabaseMock;
  return trigger;
}

describe('AutoUpdateTrigger psadtConfig handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ensurePsadtConfig', () => {
    it('backfills psadtConfig from the most recent packaging job and persists it', async () => {
      const updateSpy = vi.fn();
      const supabase = createSupabaseMock({
        upload_history: {
          maybeSingleResult: { data: { packaging_job_id: 'job-1' }, error: null },
        },
        packaging_jobs: {
          maybeSingleResult: {
            data: { package_config: { psadtConfig: PSADT_CONFIG, assignments: [] } },
            error: null,
          },
        },
        app_update_policies: { updateSpy },
      });
      const trigger = makeTrigger(supabase);
      const policy = makePolicy({ displayName: 'Test App' });

      await (trigger as unknown as {
        ensurePsadtConfig: (p: AppUpdatePolicy) => Promise<void>;
      }).ensurePsadtConfig(policy);

      const config = policy.deployment_config as DeploymentConfig;
      expect(config.psadtConfig).toEqual(PSADT_CONFIG);
      expect(updateSpy).toHaveBeenCalledWith({ deployment_config: policy.deployment_config });
    });

    it('does nothing when the policy already carries psadtConfig', async () => {
      const supabase = createSupabaseMock({});
      const trigger = makeTrigger(supabase);
      const policy = makePolicy({
        displayName: 'Test App',
        psadtConfig: PSADT_CONFIG,
      } as Partial<DeploymentConfig>);

      await (trigger as unknown as {
        ensurePsadtConfig: (p: AppUpdatePolicy) => Promise<void>;
      }).ensurePsadtConfig(policy);

      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('leaves the policy untouched when no prior packaging job exists', async () => {
      const updateSpy = vi.fn();
      const supabase = createSupabaseMock({
        upload_history: { maybeSingleResult: { data: null, error: null } },
        app_update_policies: { updateSpy },
      });
      const trigger = makeTrigger(supabase);
      const policy = makePolicy({ displayName: 'Test App' });

      await (trigger as unknown as {
        ensurePsadtConfig: (p: AppUpdatePolicy) => Promise<void>;
      }).ensurePsadtConfig(policy);

      expect((policy.deployment_config as DeploymentConfig).psadtConfig).toBeUndefined();
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });

  describe('createPackagingJob', () => {
    it('stores psadtConfig and nested installer info on the new job package_config', async () => {
      const insertSpy = vi.fn();
      const supabase = createSupabaseMock({
        user_profiles: { singleResult: { data: { email: 'user@example.com' }, error: null } },
        user_settings: { maybeSingleResult: { data: null, error: null } },
        packaging_jobs: {
          insertSpy,
          singleResult: { data: { id: 'job-2' }, error: null },
        },
      });
      const trigger = makeTrigger(supabase);
      const policy = makePolicy({
        displayName: 'Test App',
        publisher: 'Test Publisher',
        architecture: 'x64',
        installerType: 'zip',
        installCommand: 'setup.exe /S',
        uninstallCommand: '',
        installScope: 'machine',
        detectionRules: [],
        psadtConfig: PSADT_CONFIG,
      } as Partial<DeploymentConfig>);

      const result = await (trigger as unknown as {
        createPackagingJob: (
          p: AppUpdatePolicy,
          u: typeof UPDATE_INFO,
          h: string
        ) => Promise<{ id: string }>;
      }).createPackagingJob(policy, UPDATE_INFO, 'history-1');

      expect(result.id).toBe('job-2');
      expect(insertSpy).toHaveBeenCalledTimes(1);
      const jobData = insertSpy.mock.calls[0][0] as {
        package_config: Record<string, unknown>;
      };
      expect(jobData.package_config.psadtConfig).toEqual(PSADT_CONFIG);
      expect(jobData.package_config.nestedInstallerType).toBe('exe');
      expect(jobData.package_config.nestedInstallerPath).toBe('setup-2.0.0.exe');
    });

    it('persists relationships and auto-supersedence info on the new job package_config', async () => {
      const relationships = [
        {
          relationshipType: 'dependency' as const,
          targetId: 'dep-app-1',
          targetDisplayName: 'Dependency App',
          dependencyType: 'autoInstall' as const,
        },
      ];
      const insertSpy = vi.fn();
      const supabase = createSupabaseMock({
        user_profiles: { singleResult: { data: { email: 'user@example.com' }, error: null } },
        user_settings: {
          maybeSingleResult: {
            data: { settings: { supersedePreviousApp: true } },
            error: null,
          },
        },
        packaging_jobs: {
          insertSpy,
          singleResult: { data: { id: 'job-3' }, error: null },
        },
      });
      const trigger = makeTrigger(supabase);
      const policy = makePolicy({
        displayName: 'Test App',
        publisher: 'Test Publisher',
        architecture: 'x64',
        installerType: 'zip',
        installCommand: 'setup.exe /S',
        uninstallCommand: '',
        installScope: 'machine',
        detectionRules: [],
        relationships,
      } as Partial<DeploymentConfig>);

      await (trigger as unknown as {
        createPackagingJob: (
          p: AppUpdatePolicy,
          u: typeof UPDATE_INFO & { currentIntuneAppId?: string },
          h: string
        ) => Promise<{ id: string }>;
      }).createPackagingJob(
        policy,
        { ...UPDATE_INFO, currentIntuneAppId: 'prev-app-1' },
        'history-1'
      );

      expect(insertSpy).toHaveBeenCalledTimes(1);
      const jobData = insertSpy.mock.calls[0][0] as {
        package_config: Record<string, unknown>;
      };
      expect(jobData.package_config.relationships).toEqual(relationships);
      expect(jobData.package_config.autoSupersede).toBe(true);
      expect(jobData.package_config.sourceIntuneAppId).toBe('prev-app-1');
      expect(jobData.package_config.supersedenceType).toBe('update');
    });

    it('does not flag auto-supersedence when the user setting is off', async () => {
      const insertSpy = vi.fn();
      const supabase = createSupabaseMock({
        user_profiles: { singleResult: { data: { email: 'user@example.com' }, error: null } },
        user_settings: { maybeSingleResult: { data: null, error: null } },
        packaging_jobs: {
          insertSpy,
          singleResult: { data: { id: 'job-4' }, error: null },
        },
      });
      const trigger = makeTrigger(supabase);
      const policy = makePolicy({
        displayName: 'Test App',
        publisher: 'Test Publisher',
        architecture: 'x64',
        installerType: 'zip',
        installCommand: 'setup.exe /S',
        uninstallCommand: '',
        installScope: 'machine',
        detectionRules: [],
      } as Partial<DeploymentConfig>);

      await (trigger as unknown as {
        createPackagingJob: (
          p: AppUpdatePolicy,
          u: typeof UPDATE_INFO & { currentIntuneAppId?: string },
          h: string
        ) => Promise<{ id: string }>;
      }).createPackagingJob(
        policy,
        { ...UPDATE_INFO, currentIntuneAppId: 'prev-app-1' },
        'history-1'
      );

      expect(insertSpy).toHaveBeenCalledTimes(1);
      const jobData = insertSpy.mock.calls[0][0] as {
        package_config: Record<string, unknown>;
      };
      expect(jobData.package_config.autoSupersede).toBe(false);
      expect(jobData.package_config.supersedenceType).toBeUndefined();
    });
  });
});
