import { describe, expect, it } from 'vite-plus/test';

import {
  DEFAULT_APP_PORT,
  DEFAULT_DEV_CLIENT_PORT,
  DEFAULT_PGID,
  DEFAULT_PUID,
  OUTPUT_CATEGORIES,
  PLEX_EDITION_MAX_LENGTH,
  PLEX_SAMPLE_MAX_BYTES,
  SUBTITLE_MERGE_MODES
} from '../src/domain/constants.ts';
import {
  asClientId,
  asImdbId,
  asIso639_2Code,
  asItemId,
  asJobId,
  asTmdbId,
  asTvdbId
} from '../src/domain/types.ts';
import { version } from '../src/index.ts';

describe('project initialization and domain contracts', () => {
  it('exposes initial version', () => {
    expect(version).toBe('0.0.0');
  });

  it('exposes canonical Plex organizer constants and branded ID constructors', () => {
    expect(DEFAULT_APP_PORT).toBe(3000);
    expect(DEFAULT_DEV_CLIENT_PORT).toBe(5173);
    expect(DEFAULT_PUID).toBe(1000);
    expect(DEFAULT_PGID).toBe(1000);
    expect(PLEX_EDITION_MAX_LENGTH).toBe(32);
    expect(PLEX_SAMPLE_MAX_BYTES).toBe(300 * 1024 * 1024);
    expect(OUTPUT_CATEGORIES).toContain('movies');
    expect(OUTPUT_CATEGORIES).toContain('tv-shows');
    expect(SUBTITLE_MERGE_MODES).toContain('keep-and-add');

    expect(asItemId('item-1')).toBe('item-1');
    expect(asJobId('job-1')).toBe('job-1');
    expect(asClientId('client:1')).toBe('client:1');
    expect(asImdbId('tt0816692')).toBe('tt0816692');
    expect(asTvdbId('416744')).toBe('416744');
    expect(asTmdbId('157336')).toBe('157336');
    expect(asIso639_2Code('spa')).toBe('spa');
  });

  it('throws loudly when branded domain IDs are empty or invalid', () => {
    expect(() => asItemId('')).toThrow(/Invalid ItemId/i);
    expect(() => asJobId('   ')).toThrow(/Invalid JobId/i);
    expect(() => asClientId('')).toThrow(/Invalid ClientId/i);
    expect(() => asImdbId('invalid')).toThrow(/Invalid ImdbId/i);
    expect(() => asTvdbId('abc')).toThrow(/Invalid TvdbId/i);
    expect(() => asTmdbId('xyz')).toThrow(/Invalid TmdbId/i);
    expect(() => asIso639_2Code('en')).toThrow(/Invalid ISO 639-2/i);
    expect(() => asIso639_2Code('123')).toThrow(/Invalid ISO 639-2/i);
  });
});
