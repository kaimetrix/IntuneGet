/**
 * Cart Store
 * Zustand store for managing the upload cart
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartItem, Win32CartItem, StoreCartItem, NewCartItem } from '@/types/upload';
import { isStoreCartItem, isWin32CartItem } from '@/types/upload';
import type { NormalizedInstaller, WingetScope } from '@/types/winget';
import type { PSADTConfig } from '@/types/psadt';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';

interface CartState {
  items: CartItem[];
  isOpen: boolean;
  autoOpenOnAdd: boolean;
}

interface CartActions {
  addItem: (item: NewCartItem) => void;
  addItemSilent: (item: NewCartItem) => void;
  setAutoOpenOnAdd: (enabled: boolean) => void;
  setAutoOpenOnAddFromServer: (enabled: boolean) => void;
  removeItem: (id: string) => void;
  updateItem: (id: string, updates: Partial<CartItem>) => void;
  clearCart: () => void;
  toggleCart: () => void;
  openCart: () => void;
  closeCart: () => void;
  isInCart: (
    wingetId: string,
    version: string,
    architecture?: string,
    scopeOrExperience?: string
  ) => boolean;
  getItemCount: () => number;
}

type CartStore = CartState & CartActions;

function generateCartItemId(item: NewCartItem): string {
  if ('appSource' in item && item.appSource === 'store') {
    const store = item as Omit<StoreCartItem, 'id' | 'addedAt'>;
    return `store-${store.wingetId}-${store.version}-${store.installExperience}-${Date.now()}`;
  }
  const win32 = item as Omit<Win32CartItem, 'id' | 'addedAt'>;
  return `${win32.wingetId}-${win32.version}-${win32.architecture || 'neutral'}-${win32.installScope}-${Date.now()}`;
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      isOpen: false,
      autoOpenOnAdd: true,

      addItem: (item) => {
        const id = generateCartItemId(item);
        const shouldOpenCart = get().autoOpenOnAdd;
        set((state) => ({
          items: [
            ...state.items,
            {
              ...item,
              id,
              addedAt: new Date().toISOString(),
            } as CartItem,
          ],
          isOpen: shouldOpenCart,
        }));
      },

      addItemSilent: (item) => {
        const id = generateCartItemId(item);
        set((state) => ({
          items: [
            ...state.items,
            {
              ...item,
              id,
              addedAt: new Date().toISOString(),
            } as CartItem,
          ],
          // Don't open cart - used for bulk operations
        }));
      },

      removeItem: (id) => {
        set((state) => ({
          items: state.items.filter((item) => item.id !== id),
        }));
      },

      setAutoOpenOnAdd: (enabled) => {
        set({ autoOpenOnAdd: enabled });
      },
      setAutoOpenOnAddFromServer: (enabled) => {
        set({ autoOpenOnAdd: enabled });
      },

      updateItem: (id, updates) => {
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id ? { ...item, ...updates } as CartItem : item
          ),
        }));
      },

      clearCart: () => {
        set({ items: [] });
      },

      toggleCart: () => {
        set((state) => ({ isOpen: !state.isOpen }));
      },

      openCart: () => {
        set({ isOpen: true });
      },

      closeCart: () => {
        set({ isOpen: false });
      },

      isInCart: (wingetId, version, architecture, scopeOrExperience) => {
        return get().items.some((item) => {
          if (item.wingetId !== wingetId || item.version !== version) return false;
          if (isStoreCartItem(item)) {
            // Store items distinguish by installExperience (user vs system)
            if (!scopeOrExperience) return true;
            return item.installExperience === scopeOrExperience;
          }
          if (isWin32CartItem(item)) {
            // Win32 items distinguish by architecture AND installScope
            if (architecture && item.architecture !== architecture) return false;
            if (scopeOrExperience && item.installScope !== scopeOrExperience) return false;
            return true;
          }
          return true;
        });
      },

      getItemCount: () => {
        return get().items.length;
      },
    }),
    {
      name: 'intuneget-cart',
      version: 1,
      partialize: (state) => ({
        items: state.items,
        autoOpenOnAdd: state.autoOpenOnAdd,
      }),
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as { items?: CartItem[]; autoOpenOnAdd?: boolean };
        if (version === 0 && state.items) {
          // Backfill appSource: 'win32' for items persisted before store app support
          state.items = state.items.map((item) => {
            if (!item.appSource) {
              return Object.assign({}, item, { appSource: 'win32' as const }) as CartItem;
            }
            return item;
          });
        }
        return state;
      },
    }
  )
);

// Helper function to create a Win32 cart item from package and installer data
export function createCartItem(
  wingetId: string,
  displayName: string,
  publisher: string,
  version: string,
  installer: NormalizedInstaller,
  installScope: WingetScope = 'machine',
  psadtConfig?: Partial<PSADTConfig>
): Omit<Win32CartItem, 'id' | 'addedAt'> {
  // Import detection rule generator
  const { generateDetectionRules, generateInstallCommand, generateUninstallCommand } = require('@/lib/detection-rules');

  // Pass wingetId and version for registry marker detection (most reliable for EXE installers)
  const detectionRules = generateDetectionRules(installer, displayName, wingetId, version);

  return {
    appSource: 'win32',
    wingetId,
    displayName,
    publisher,
    version,
    architecture: installer.architecture,
    installScope,
    installerType: installer.type,
    installerUrl: installer.url,
    installerSha256: installer.sha256,
    installCommand: generateInstallCommand(installer, installScope),
    uninstallCommand: generateUninstallCommand(installer, displayName),
    detectionRules,
    psadtConfig: {
      ...DEFAULT_PSADT_CONFIG,
      detectionRules,
      ...psadtConfig,
    },
  };
}

// Helper function to create a Store cart item
export function createStoreCartItem(
  packageIdentifier: string,
  displayName: string,
  publisher: string,
  version: string,
  installExperience: 'user' | 'system' = 'user',
  options?: {
    description?: string;
    iconPath?: string;
  }
): Omit<StoreCartItem, 'id' | 'addedAt'> {
  return {
    appSource: 'store',
    wingetId: packageIdentifier, // Use store ID as the wingetId for consistency
    displayName,
    publisher,
    version,
    packageIdentifier,
    installExperience,
    description: options?.description,
    iconPath: options?.iconPath,
  };
}
