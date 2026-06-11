'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Link2,
  Loader2,
  RefreshCw,
  Search,
  ToggleLeft,
  ToggleRight,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useMspOptional } from '@/hooks/useMspOptional';
import type {
  AppRelationship,
  AppRelationshipType,
  DependencyType,
  SupersedenceType,
} from '@/types/intune';

interface ManifestDependency {
  packageIdentifier: string;
  minimumVersion?: string;
}

interface DependencyConfigProps {
  relationships: AppRelationship[];
  onChange: (relationships: AppRelationship[]) => void;
  manifestDependencies?: ManifestDependency[];
}

interface TenantApp {
  id: string;
  displayName: string;
  displayVersion?: string;
  publisher?: string;
}

interface InventoryResponse {
  apps: TenantApp[];
  count: number;
}

export function DependencyConfig({ relationships, onChange, manifestDependencies }: DependencyConfigProps) {
  const [enabled, setEnabled] = useState(() => relationships.length > 0);
  const [query, setQuery] = useState('');
  const [tenantApps, setTenantApps] = useState<TenantApp[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  const { getAccessToken } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();

  const loadTenantApps = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError('Not authenticated');
        return;
      }

      const response = await fetch('/api/intune/apps', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}),
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to load tenant apps');
      }

      const data: InventoryResponse = await response.json();
      const normalized = (data.apps || [])
        .filter((app) => app?.id && app?.displayName)
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      setTenantApps(normalized);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tenant apps');
      setTenantApps([]);
    } finally {
      setIsLoading(false);
    }
  }, [getAccessToken, isMspUser, selectedTenantId]);

  useEffect(() => {
    if (!enabled || tenantApps.length > 0 || isLoading) {
      return;
    }
    void loadTenantApps();
  }, [enabled, tenantApps.length, isLoading, loadTenantApps]);

  const selectedIds = useMemo(
    () => new Set(relationships.map((r) => r.targetId)),
    [relationships]
  );

  // Best-effort match of a winget dependency id against the tenant app list
  const findManifestMatch = useCallback(
    (packageIdentifier: string): TenantApp | undefined => {
      const lastSegment = (packageIdentifier.split('.').pop() || packageIdentifier).toLowerCase();
      if (!lastSegment) return undefined;
      return tenantApps.find((app) => {
        const name = app.displayName.toLowerCase();
        return name.includes(lastSegment) || lastSegment.includes(name);
      });
    },
    [tenantApps]
  );

  const filteredApps = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    // Filter out already-selected apps
    const available = tenantApps.filter((app) => !selectedIds.has(app.id));
    if (!normalizedQuery) {
      return available;
    }
    return available.filter(
      (app) =>
        app.displayName.toLowerCase().includes(normalizedQuery) ||
        (app.publisher && app.publisher.toLowerCase().includes(normalizedQuery))
    );
  }, [tenantApps, query, selectedIds]);

  const handleToggleEnabled = () => {
    const next = !enabled;
    setEnabled(next);
    if (!next) {
      onChange([]);
      setShowPicker(false);
    } else if (tenantApps.length === 0) {
      void loadTenantApps();
    }
  };

  const addRelationship = (app: TenantApp) => {
    const newRel: AppRelationship = {
      relationshipType: 'dependency',
      targetId: app.id,
      targetDisplayName: app.displayName,
      targetVersion: app.displayVersion,
      dependencyType: 'autoInstall',
    };
    onChange([...relationships, newRel]);
    setQuery('');
    setShowPicker(false);
  };

  const removeRelationship = (targetId: string) => {
    onChange(relationships.filter((r) => r.targetId !== targetId));
  };

  const updateRelationshipType = (targetId: string, type: AppRelationshipType) => {
    onChange(
      relationships.map((r) => {
        if (r.targetId !== targetId) return r;
        if (type === 'dependency') {
          return { ...r, relationshipType: type, dependencyType: 'autoInstall' as DependencyType, supersedenceType: undefined };
        }
        return { ...r, relationshipType: type, supersedenceType: 'update' as SupersedenceType, dependencyType: undefined };
      })
    );
  };

  const updateSubType = (targetId: string, value: string) => {
    onChange(
      relationships.map((r) => {
        if (r.targetId !== targetId) return r;
        if (r.relationshipType === 'dependency') {
          return { ...r, dependencyType: value as DependencyType };
        }
        return { ...r, supersedenceType: value as SupersedenceType };
      })
    );
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={handleToggleEnabled}
        className="flex items-center gap-3 w-full p-3 rounded-lg border border-overlay/15 bg-bg-elevated/50 hover:bg-overlay/10 transition-colors"
      >
        {enabled ? (
          <ToggleRight className="w-6 h-6 text-blue-400 flex-shrink-0" />
        ) : (
          <ToggleLeft className="w-6 h-6 text-text-muted flex-shrink-0" />
        )}
        <div className="flex-1 text-left">
          <p className={cn('text-sm font-medium', enabled ? 'text-text-primary' : 'text-text-muted')}>
            Configure Dependencies
          </p>
          <p className="text-xs text-text-muted">
            {enabled
              ? 'Relationships will be applied in Intune after deployment'
              : 'Deploy without app dependencies or supersedence'}
          </p>
        </div>
      </button>

      {enabled && (
        <div className="space-y-3">
          {/* Info banner */}
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Target apps must already exist in your Intune tenant. Apps in the same deployment batch cannot reference each other.
            </p>
          </div>

          {/* Manifest dependency suggestions */}
          {manifestDependencies && manifestDependencies.length > 0 && (
            <div className="rounded-lg border border-overlay/15 bg-bg-elevated/60 p-3 space-y-2">
              <p className="text-xs font-medium text-text-secondary">
                Suggested by the app&apos;s manifest
              </p>
              {manifestDependencies.map((dep) => {
                const match = findManifestMatch(dep.packageIdentifier);
                const alreadyAdded = match ? selectedIds.has(match.id) : false;
                return (
                  <div
                    key={dep.packageIdentifier}
                    className="flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs text-text-primary truncate">{dep.packageIdentifier}</p>
                      {dep.minimumVersion && (
                        <p className="text-xs text-text-muted">min v{dep.minimumVersion}</p>
                      )}
                    </div>
                    {match ? (
                      alreadyAdded ? (
                        <span className="text-xs text-text-muted flex-shrink-0">Added</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => addRelationship(match)}
                          className="px-2 py-1 rounded-md border border-overlay/15 bg-bg-elevated text-xs text-text-secondary hover:bg-overlay/10 transition-colors flex-shrink-0"
                        >
                          Add
                        </button>
                      )
                    ) : (
                      <span className="text-xs text-text-muted flex-shrink-0">
                        Deploy {dep.packageIdentifier} first, then add it here
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Selected relationships */}
          {relationships.length > 0 && (
            <div className="space-y-2">
              {relationships.map((rel) => (
                <div
                  key={rel.targetId}
                  className="rounded-lg border border-overlay/15 bg-bg-elevated/60 p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Link2 className="w-4 h-4 text-blue-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm text-text-primary font-medium truncate">
                          {rel.targetDisplayName}
                        </p>
                        {rel.targetVersion && (
                          <p className="text-xs text-text-muted">v{rel.targetVersion}</p>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRelationship(rel.targetId)}
                      className="text-text-muted hover:text-red-400 transition-colors flex-shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex gap-2">
                    {/* Relationship type */}
                    <select
                      value={rel.relationshipType}
                      onChange={(e) =>
                        updateRelationshipType(rel.targetId, e.target.value as AppRelationshipType)
                      }
                      className="flex-1 px-2 py-1.5 bg-bg-elevated border border-overlay/15 rounded-md text-text-primary text-xs"
                    >
                      <option value="dependency">Dependency</option>
                      <option value="supersedence">Supersedence</option>
                    </select>

                    {/* Sub-type */}
                    <select
                      value={
                        rel.relationshipType === 'dependency'
                          ? rel.dependencyType || 'autoInstall'
                          : rel.supersedenceType || 'update'
                      }
                      onChange={(e) => updateSubType(rel.targetId, e.target.value)}
                      className="flex-1 px-2 py-1.5 bg-bg-elevated border border-overlay/15 rounded-md text-text-primary text-xs"
                    >
                      {rel.relationshipType === 'dependency' ? (
                        <>
                          <option value="autoInstall">Auto Install</option>
                          <option value="detect">Detect Only</option>
                        </>
                      ) : (
                        <>
                          <option value="update">Update</option>
                          <option value="replace">Replace</option>
                        </>
                      )}
                    </select>
                  </div>

                  <p className="text-xs text-text-muted">
                    {rel.relationshipType === 'dependency'
                      ? rel.dependencyType === 'autoInstall'
                        ? 'This app will be automatically installed before the parent app'
                        : 'Installation will check if this app is already present'
                      : rel.supersedenceType === 'replace'
                        ? 'The old app will be uninstalled and replaced with the new app'
                        : 'The old app will be updated in-place to the new version'}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* App picker */}
          {showPicker ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search tenant apps..."
                    autoFocus
                    className="w-full pl-10 pr-3 py-2.5 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary text-sm placeholder-text-muted focus:border-overlay/20 focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void loadTenantApps()}
                  disabled={isLoading}
                  className="px-3 py-2.5 rounded-lg border border-overlay/15 bg-bg-elevated text-text-secondary hover:bg-overlay/10 transition-colors disabled:opacity-50"
                  title="Refresh apps"
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                </button>
              </div>

              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {error}
                </div>
              )}

              {isLoading && tenantApps.length === 0 ? (
                <div className="flex items-center gap-2 text-text-muted text-sm py-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading tenant apps...
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                  {filteredApps.length === 0 ? (
                    <p className="text-text-muted text-sm py-2">
                      {tenantApps.length === 0
                        ? 'No Win32 apps found in your tenant'
                        : 'No apps match your search'}
                    </p>
                  ) : (
                    filteredApps.map((app) => (
                      <button
                        key={app.id}
                        type="button"
                        onClick={() => addRelationship(app)}
                        className="w-full text-left px-3 py-2.5 rounded-lg border bg-bg-elevated/60 border-overlay/15 text-text-secondary hover:border-overlay/20 hover:bg-overlay/10 transition-colors"
                      >
                        <p className="text-sm truncate">{app.displayName}</p>
                        <p className="text-xs text-text-muted truncate">
                          {[app.publisher, app.displayVersion && `v${app.displayVersion}`]
                            .filter(Boolean)
                            .join(' - ')}
                        </p>
                      </button>
                    ))
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  setShowPicker(false);
                  setQuery('');
                }}
                className="text-xs text-text-muted hover:text-text-secondary transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              className="w-full px-3 py-2.5 rounded-lg border border-dashed border-overlay/20 text-text-muted hover:text-text-secondary hover:border-overlay/30 transition-colors text-sm"
            >
              + Add app relationship
            </button>
          )}

          <p className="text-xs text-text-muted">
            Configured: {relationships.length} relationship{relationships.length !== 1 ? 's' : ''}
          </p>
        </div>
      )}
    </div>
  );
}
