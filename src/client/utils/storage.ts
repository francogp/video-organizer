import { DEFAULT_PREFERRED_LANGUAGES, METADATA_LANGUAGE_CODES } from '../../domain/constants.ts';
import type { MetadataLanguageCode } from '../../domain/types.ts';
import type { PersistedTablePreferences, TableId } from '../components/table/tableTypes.ts';

const THEME_MODES = ['dark', 'light'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

const BROWSER_ID_KEY = 'vo_browser_id';
const TAB_ID_KEY = 'vo_tab_id';
const THEME_KEY = 'vo_theme_mode';
const PREFERRED_LANGS_KEY = 'vo_preferred_languages_v1';
const TABLE_PREFS_PREFIX = 'vo_table_prefs_v1_';

const RADIX_ALPHANUMERIC = 36;
const ID_SLICE_START = 2;
const ID_SLICE_END = 10;
const UUID_PREFIX_LEN = 8;

function createRandomId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID().slice(0, UUID_PREFIX_LEN);
  }
  return Math.random().toString(RADIX_ALPHANUMERIC).slice(ID_SLICE_START, ID_SLICE_END);
}

function readStorage(store: Storage | undefined, key: string): string | null {
  try {
    return store ? store.getItem(key) : null;
  } catch {
    return null;
  }
}

function writeStorage(store: Storage | undefined, key: string, value: string): void {
  try {
    store?.setItem(key, value);
  } catch {
    // Ignore storage quota or private browsing errors
  }
}

/** Returns a stable `browserId:tabId` client identifier for LAN locking. */
export function getOrCreateClientId(): string {
  const local = typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined;
  const session = typeof globalThis !== 'undefined' ? globalThis.sessionStorage : undefined;

  let browserId = readStorage(local, BROWSER_ID_KEY);
  if (!browserId) {
    browserId = createRandomId();
    writeStorage(local, BROWSER_ID_KEY, browserId);
  }

  let tabId = readStorage(session, TAB_ID_KEY);
  if (!tabId) {
    tabId = createRandomId();
    writeStorage(session, TAB_ID_KEY, tabId);
  }

  return `${browserId}:${tabId}`;
}

/** Reads persisted theme preference or falls back to system `prefers-color-scheme`. */
export function getInitialThemeMode(): ThemeMode {
  const local = typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined;
  const saved = readStorage(local, THEME_KEY);
  if (saved === 'dark' || saved === 'light') {
    return saved;
  }
  if (
    typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia('(prefers-color-scheme: light)').matches
  ) {
    return 'light';
  }
  return 'dark';
}

/** Persists manual theme preference safely. */
export function saveThemeMode(mode: ThemeMode): void {
  const local = typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined;
  writeStorage(local, THEME_KEY, mode);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Loads persisted column order and widths for a table, returning null when absent or invalid. */
export function loadTablePreferences<ColId extends string>(
  tableId: TableId
): PersistedTablePreferences<ColId> | null {
  const local = typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined;
  const raw = readStorage(local, `${TABLE_PREFS_PREFIX}${tableId}`);
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.order)) {
      return null;
    }
    const order = parsed.order.filter((id): id is ColId => typeof id === 'string');
    const widths: Partial<Record<ColId, number>> = {};
    if (isRecord(parsed.widths)) {
      for (const [key, val] of Object.entries(parsed.widths)) {
        if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
          widths[key as ColId] = val;
        }
      }
    }
    return { version: 1, order, widths };
  } catch {
    return null;
  }
}

/** Persists column order and widths for a table to localStorage. */
export function saveTablePreferences<ColId extends string>(
  tableId: TableId,
  prefs: PersistedTablePreferences<ColId>
): void {
  const local = typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined;
  writeStorage(local, `${TABLE_PREFS_PREFIX}${tableId}`, JSON.stringify(prefs));
}

/** Clears persisted column preferences for a table. */
export function clearTablePreferences(tableId: TableId): void {
  const local = typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined;
  try {
    local?.removeItem(`${TABLE_PREFS_PREFIX}${tableId}`);
  } catch {
    // Ignore storage quota or private browsing errors
  }
}

/** Reads persisted preferred metadata language order, or null if not saved. */
export function loadSavedPreferredLanguages(): readonly MetadataLanguageCode[] | null {
  const local = typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined;
  const raw = readStorage(local, PREFERRED_LANGS_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return null;
    }
    const allowed = new Set<string>(METADATA_LANGUAGE_CODES);
    const clean = parsed.filter(
      (code): code is MetadataLanguageCode => typeof code === 'string' && allowed.has(code)
    );
    return clean.length > 0 ? clean : null;
  } catch {
    return null;
  }
}

/** Returns initial preferred metadata language order (saved or default). */
export function getInitialPreferredLanguages(): readonly MetadataLanguageCode[] {
  return loadSavedPreferredLanguages() ?? [...DEFAULT_PREFERRED_LANGUAGES];
}

/** Persists preferred metadata language order to localStorage. */
export function savePreferredLanguages(languages: readonly MetadataLanguageCode[]): void {
  const local = typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined;
  writeStorage(local, PREFERRED_LANGS_KEY, JSON.stringify(languages));
}
