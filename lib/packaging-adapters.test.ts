import { describe, expect, it } from 'vitest';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import { applyApplicationPackagingAdapter } from './packaging-adapters';

describe('application packaging adapters', () => {
  it('adds the reviewed Stream Deck lifecycle process to the exact app', () => {
    const adapted = applyApplicationPackagingAdapter(
      'Elgato.StreamDeck',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.processesToClose).toEqual([
      { name: 'StreamDeck', description: 'Elgato Stream Deck' },
    ]);
    expect(DEFAULT_PSADT_CONFIG.processesToClose).toEqual([]);
  });

  it('matches WinGet identities case-insensitively', () => {
    expect(
      applyApplicationPackagingAdapter('  elgato.streamdeck  ', DEFAULT_PSADT_CONFIG)
        .processesToClose
    ).toEqual([
      { name: 'StreamDeck', description: 'Elgato Stream Deck' },
    ]);
  });

  it('preserves customer processes and deduplicates names with an exe suffix', () => {
    const adapted = applyApplicationPackagingAdapter('Elgato.StreamDeck', {
      ...DEFAULT_PSADT_CONFIG,
      processesToClose: [
        { name: 'streamdeck.exe', description: 'Customer description' },
        { name: 'companion', description: 'Companion app' },
      ],
    });

    expect(adapted.processesToClose).toEqual([
      { name: 'streamdeck', description: 'Customer description' },
      { name: 'companion', description: 'Companion app' },
    ]);
  });

  it('does not attach an adapter to a different application identity', () => {
    const config = { ...DEFAULT_PSADT_CONFIG, processesToClose: [] };
    expect(applyApplicationPackagingAdapter('Example.StreamDeck', config)).toBe(config);
  });
});
