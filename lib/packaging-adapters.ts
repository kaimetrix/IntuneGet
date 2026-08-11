import type { ProcessToClose, PSADTConfig } from '@/types/psadt';

interface ApplicationPackagingAdapter {
  wingetId: string;
  requiredProcessesToClose?: readonly ProcessToClose[];
}

/**
 * Reviewed application-specific behavior that cannot be derived safely from a
 * WinGet manifest. Keep this registry declarative: executable implementation
 * remains in the shared PSADT packagers and every effective value is included
 * in the QA execution-profile hash.
 */
export const APPLICATION_PACKAGING_ADAPTERS: readonly ApplicationPackagingAdapter[] = [
  {
    wingetId: 'Elgato.StreamDeck',
    requiredProcessesToClose: [
      { name: 'StreamDeck', description: 'Elgato Stream Deck' },
    ],
  },
];

function normalizeProcessName(name: string): string {
  return name.trim().replace(/\.exe$/i, '');
}

export function applyApplicationPackagingAdapter(
  wingetId: string,
  config: PSADTConfig
): PSADTConfig {
  const normalizedWingetId = wingetId.trim().toLowerCase();
  const adapter = APPLICATION_PACKAGING_ADAPTERS.find(
    ({ wingetId: adapterWingetId }) => adapterWingetId.toLowerCase() === normalizedWingetId
  );
  if (!adapter?.requiredProcessesToClose?.length) return config;

  const processesToClose = (config.processesToClose || []).map((process) => {
    const name = normalizeProcessName(process.name);
    if (!name) {
      throw new Error(`Invalid empty PSADT process name for ${adapter.wingetId}`);
    }
    return { ...process, name };
  });
  const configuredNames = new Set(
    processesToClose.map(({ name }) => name.toLowerCase())
  );

  for (const required of adapter.requiredProcessesToClose) {
    const normalizedName = normalizeProcessName(required.name);
    if (!configuredNames.has(normalizedName.toLowerCase())) {
      processesToClose.push({ ...required, name: normalizedName });
      configuredNames.add(normalizedName.toLowerCase());
    }
  }

  return { ...config, processesToClose };
}
