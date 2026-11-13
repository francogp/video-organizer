import { fitTvEpisodeTitleToBudget, sanitizePlexSegment } from '../../domain/constants.ts';
import type { MediaKind, MediaProbeSummary, ScannedItem } from '../../domain/types.ts';

const BYTES_PER_MB = 1024 * 1024;
const BUENOS_AIRES_TZ = 'America/Argentina/Buenos_Aires';
const PAD_TWO = 2;

const mbNumberFormatter = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
});

const baFormatter = new Intl.DateTimeFormat('es-AR', {
  timeZone: BUENOS_AIRES_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

/** Formats a byte count into a human-readable megabytes label using Argentine (`es-AR`) notation. */
export function formatSizeMb(bytes: number): string {
  return `${mbNumberFormatter.format(bytes / BYTES_PER_MB)} MB`;
}

/** Formats a byte-size difference into a signed megabytes label using Argentine (`es-AR`) notation. */
export function formatSizeDeltaMb(incomingBytes: number, existingBytes: number): string {
  const diffMb = (incomingBytes - existingBytes) / BYTES_PER_MB;
  const sign = diffMb >= 0 ? '+' : '';
  return `${sign}${mbNumberFormatter.format(diffMb)} MB`;
}

/** Formats an ISO-8601 UTC timestamp into `America/Argentina/Buenos_Aires` local time. */
export function formatBuenosAiresTimestamp(iso: string): string {
  try {
    if (typeof Temporal !== 'undefined') {
      const zoned = Temporal.Instant.from(iso).toZonedDateTimeISO(BUENOS_AIRES_TZ);
      return zoned.toLocaleString('es-AR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    }
    const epochMs = Date.parse(iso);
    if (Number.isNaN(epochMs)) {
      return iso;
    }
    return baFormatter.format(epochMs);
  } catch {
    return iso;
  }
}

export interface PathSegments {
  readonly folders: readonly string[];
  readonly fileName: string;
}

/** Splits a source relative path into folder pills and final filename. */
export function splitRelativePathSegments(relativePath: string): PathSegments {
  const parts = relativePath.split(/[\\/]+/).filter(Boolean);
  if (parts.length <= 1) {
    return { folders: [], fileName: parts[0] ?? relativePath };
  }
  return {
    folders: parts.slice(0, -1),
    fileName: parts[parts.length - 1] ?? relativePath
  };
}

/** Builds structured Plex destination folder and filename segments for UI pills. */
export function formatPlexOutputSegments(item: ScannedItem): PathSegments | null {
  const meta = item.selectedMetadata;
  const cleanTitle = meta?.title ? sanitizePlexSegment(meta.title) : '';
  if (!cleanTitle) {
    return null;
  }
  const cleanEdition = item.edition?.trim() ? sanitizePlexSegment(item.edition.trim()) : '';
  const editionTag = cleanEdition ? `{edition-${cleanEdition}}` : undefined;
  if (item.mediaKind === 'movie') {
    const parts = [cleanTitle];
    if (meta?.year) {
      parts.push(`(${String(meta.year)})`);
    }
    if (meta?.imdbId) {
      parts.push(`{imdb-${meta.imdbId}}`);
    } else if (meta?.tmdbId) {
      parts.push(`{tmdb-${meta.tmdbId}}`);
    }
    if (editionTag) {
      parts.push(editionTag);
    }
    if (item.tags.length > 0) {
      parts.push(`[${item.tags.join(', ')}]`);
    }
    const base = sanitizePlexSegment(parts.join(' '));
    const file = sanitizePlexSegment(
      item.splitPart ? `${base} - ${item.splitPart}.mkv` : `${base}.mkv`
    );
    return { folders: [base], fileName: file };
  }

  const showDisplay = meta?.year ? `${cleanTitle} (${String(meta.year)})` : cleanTitle;
  const showParts = [showDisplay];
  if (meta?.tvdbId) {
    showParts.push(`{tvdb-${meta.tvdbId}}`);
  } else if (meta?.tmdbId) {
    showParts.push(`{tmdb-${meta.tmdbId}}`);
  }
  if (editionTag) {
    showParts.push(editionTag);
  }
  const showFolder = sanitizePlexSegment(showParts.join(' '));
  const ep = item.episode ?? { seasonNumber: 1, episodeStart: 1 };
  const seasonLabel = `Season ${String(ep.seasonNumber).padStart(PAD_TWO, '0')}`;
  const startCode = `s${String(ep.seasonNumber).padStart(PAD_TWO, '0')}e${String(ep.episodeStart).padStart(PAD_TWO, '0')}`;
  const epCode =
    ep.episodeEnd && ep.episodeEnd > ep.episodeStart
      ? `${startCode}-e${String(ep.episodeEnd).padStart(PAD_TWO, '0')}`
      : startCode;
  const baseFileName = sanitizePlexSegment(`${showDisplay} - ${epCode}.mkv`);
  const baseRelLength = [showFolder, seasonLabel, baseFileName].join('/').length;
  const fittedEpTitle = ep.episodeTitle
    ? fitTvEpisodeTitleToBudget(baseRelLength, ep.episodeTitle)
    : '';
  const epTitle = fittedEpTitle ? ` - ${fittedEpTitle}` : '';
  return {
    folders: [showFolder, seasonLabel],
    fileName: sanitizePlexSegment(`${showDisplay} - ${epCode}${epTitle}.mkv`)
  };
}

const KBPS_DIVISOR = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

/** Formats a bitrate in bits/sec as rounded `kbps`. */
export function formatKbps(bps: number): string {
  return `${String(Math.round(bps / KBPS_DIVISOR))} kbps`;
}

/** Formats a duration in seconds as `Xm YYs`. */
export function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const mins = Math.floor(rounded / SECONDS_PER_MINUTE);
  const secs = rounded % SECONDS_PER_MINUTE;
  return `${String(mins)}m ${String(secs).padStart(PAD_TWO, '0')}s`;
}

/** Formats a probed stream summary for conflict comparison panels. */
export function formatProbeStreams(probe: MediaProbeSummary): string {
  const video = probe.videoStreams[0];
  const res = video ? `${String(video.width)}x${String(video.height)}` : 'no video';
  const audioLangs =
    probe.audioStreams.length > 0 ? probe.audioStreams.map((a) => a.language).join('/') : 'none';
  const subLangs =
    probe.subtitleStreams.length > 0
      ? probe.subtitleStreams.map((s) => s.language).join('/')
      : 'none';
  return `${res} · audio: ${audioLangs} · subs(${String(probe.subtitleStreams.length)}): ${subLangs}`;
}

/** Formats remaining ETA seconds into a compact human-readable string (`ETA 1m 24s`). */
export function formatEta(etaSeconds?: number): string {
  if (etaSeconds === undefined || !Number.isFinite(etaSeconds) || etaSeconds < 0) {
    return '';
  }
  const total = Math.round(etaSeconds);
  if (total < SECONDS_PER_MINUTE) {
    return `ETA ${String(total)}s`;
  }
  if (total < SECONDS_PER_HOUR) {
    const mins = Math.floor(total / SECONDS_PER_MINUTE);
    const secs = total % SECONDS_PER_MINUTE;
    return `ETA ${String(mins)}m ${String(secs)}s`;
  }
  const hours = Math.floor(total / SECONDS_PER_HOUR);
  const mins = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  return `ETA ${String(hours)}h ${String(mins)}m`;
}

export interface ConflictDecisionOption {
  readonly value: '' | 'ignore' | 'overwrite';
  readonly label: string;
  readonly disabled?: boolean;
}

/** Shared `<option>` list for conflict resolution `<select>` controls. */
export const CONFLICT_DECISION_OPTIONS: readonly ConflictDecisionOption[] = [
  { value: '', label: 'Select decision...', disabled: true },
  { value: 'ignore', label: 'Ignore (keep source untouched)' },
  { value: 'overwrite', label: 'Overwrite destination' }
];

export type ExternalProviderKind = 'tvdb' | 'imdb' | 'tmdb';

export interface ExternalIdLink {
  readonly provider: ExternalProviderKind;
  readonly id: string;
  readonly label: string;
  readonly url: string;
}

const PROVIDER_TAG_REGEX = /\{(tvdb|imdb|tmdb)-([a-z0-9]+)\}/gi;

/** Extracts `{tvdb-...}`, `{imdb-...}`, and `{tmdb-...}` tags into external verification URLs. */
export function extractExternalIdLinks(
  rootName: string,
  mediaKind: MediaKind
): readonly ExternalIdLink[] {
  const links: ExternalIdLink[] = [];
  const seen = new Set<string>();
  for (const match of rootName.matchAll(PROVIDER_TAG_REGEX)) {
    const provider = match[1]?.toLowerCase() as ExternalProviderKind | undefined;
    const id = match[2];
    if (!provider || !id) {
      continue;
    }
    const dedupeKey = `${provider}:${id}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    if (provider === 'tvdb') {
      const segment = mediaKind === 'movie' ? 'movie' : 'series';
      links.push({
        provider,
        id,
        label: 'TVDB',
        url: `https://www.thetvdb.com/dereferrer/${segment}/${encodeURIComponent(id)}`
      });
    } else if (provider === 'imdb') {
      const imdbId = id.toLowerCase().startsWith('tt') ? id : `tt${id}`;
      links.push({
        provider,
        id: imdbId,
        label: 'IMDb',
        url: `https://www.imdb.com/title/${encodeURIComponent(imdbId)}/`
      });
    } else {
      const segment = mediaKind === 'movie' ? 'movie' : 'tv';
      links.push({
        provider,
        id,
        label: 'TMDB',
        url: `https://www.themoviedb.org/${segment}/${encodeURIComponent(id)}`
      });
    }
  }
  return links;
}
