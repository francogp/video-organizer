import * as v from 'valibot';

import {
  CONFLICT_DECISIONS,
  CONFLICT_KINDS,
  EPISODE_ORDER_MODES,
  ISO_639_2_PRESETS,
  JOB_PHASES,
  JOB_STAGE_KINDS,
  LOCK_ERROR_CODES,
  LOG_LEVELS,
  MEDIA_KINDS,
  METADATA_CANDIDATE_SOURCES,
  METADATA_LANGUAGE_CODES,
  OUTPUT_CATEGORIES,
  SUBTITLE_MERGE_MODES,
  type AudioNormalizationMode,
  type AudioOutputCodec,
  type AudioSuggestionKind
} from './constants.ts';

declare const brandSymbol: unique symbol;

/** Nominal branded string type to prevent mixing distinct identifier domains. */
export type Brand<T, B extends string> = T & { readonly [brandSymbol]: B };

export type JobId = Brand<string, 'JobId'>;
export type ItemId = Brand<string, 'ItemId'>;
export type ImdbId = Brand<string, 'ImdbId'>;
export type TvdbId = Brand<string, 'TvdbId'>;
export type TmdbId = Brand<string, 'TmdbId'>;
export type ClientId = Brand<string, 'ClientId'>;

const MediaKindSchema = v.picklist(MEDIA_KINDS);
export type MediaKind = v.InferOutput<typeof MediaKindSchema>;

const OutputCategorySchema = v.picklist(OUTPUT_CATEGORIES);
export type OutputCategory = v.InferOutput<typeof OutputCategorySchema>;

const JobPhaseSchema = v.picklist(JOB_PHASES);
export type JobPhase = v.InferOutput<typeof JobPhaseSchema>;

const ConflictDecisionSchema = v.picklist(CONFLICT_DECISIONS);
export type ConflictDecision = v.InferOutput<typeof ConflictDecisionSchema>;

const SubtitleMergeModeSchema = v.picklist(SUBTITLE_MERGE_MODES);
export type SubtitleMergeMode = v.InferOutput<typeof SubtitleMergeModeSchema>;

const EpisodeOrderModeSchema = v.picklist(EPISODE_ORDER_MODES);
export type EpisodeOrderMode = v.InferOutput<typeof EpisodeOrderModeSchema>;

const Iso639_2PresetSchema = v.picklist(ISO_639_2_PRESETS);
export type Iso639_2Preset = v.InferOutput<typeof Iso639_2PresetSchema>;

export type Iso639_2Code = Brand<string, 'Iso639_2Code'>;

const LogLevelSchema = v.picklist(LOG_LEVELS);
export type LogLevel = v.InferOutput<typeof LogLevelSchema>;

const MetadataCandidateSourceSchema = v.picklist(METADATA_CANDIDATE_SOURCES);
export type MetadataCandidateSource = v.InferOutput<typeof MetadataCandidateSourceSchema>;

const ConflictKindSchema = v.picklist(CONFLICT_KINDS);
export type ConflictKind = v.InferOutput<typeof ConflictKindSchema>;

const LockErrorCodeSchema = v.picklist(LOCK_ERROR_CODES);
export type LockErrorCode = v.InferOutput<typeof LockErrorCodeSchema>;

function assertNonEmptyId(raw: string, label: string): string {
  if (raw.trim().length === 0) {
    throw new Error(`Invalid ${label}: "${raw}"`);
  }
  return raw;
}

function assertRegexId(raw: string, pattern: RegExp, label: string): string {
  if (!pattern.test(raw)) {
    throw new Error(`Invalid ${label}: "${raw}"`);
  }
  return raw;
}

export function asJobId(raw: string): JobId {
  return assertNonEmptyId(raw, 'JobId') as JobId;
}

export function asItemId(raw: string): ItemId {
  return assertNonEmptyId(raw, 'ItemId') as ItemId;
}

export function asImdbId(raw: string): ImdbId {
  return assertRegexId(raw, /^tt\d+$/, 'ImdbId') as ImdbId;
}

export function asTvdbId(raw: string): TvdbId {
  return assertRegexId(raw, /^\d+$/, 'TvdbId') as TvdbId;
}

export function asTmdbId(raw: string): TmdbId {
  return assertRegexId(raw, /^\d+$/, 'TmdbId') as TmdbId;
}

export function asClientId(raw: string): ClientId {
  return assertNonEmptyId(raw, 'ClientId') as ClientId;
}

export function asIso639_2Code(raw: string): Iso639_2Code {
  return assertRegexId(raw, /^[a-z]{3}$/, 'ISO 639-2 code') as Iso639_2Code;
}

export interface VideoStreamInfo {
  readonly index: number;
  readonly codecName: string;
  readonly width: number;
  readonly height: number;
  readonly bitDepth?: number;
  readonly colorTransfer?: string;
}

export interface AudioStreamInfo {
  readonly index: number;
  readonly streamOrder: number;
  readonly codecName: string;
  readonly language: Iso639_2Code;
  readonly title?: string;
  readonly channels: number;
  readonly isDefault: boolean;
}

export interface SubtitleStreamInfo {
  readonly index: number;
  readonly streamOrder: number;
  readonly codecName: string;
  readonly language: Iso639_2Code;
  readonly title?: string;
  readonly isForced: boolean;
  readonly isHearingImpaired: boolean;
}

export interface AudioTrackAnalysis {
  readonly streamOrder: number;
  readonly meanVolumeDb: number;
  readonly maxVolumeDb: number;
  readonly suggestion: AudioSuggestionKind;
  readonly recommendedGainDb: number;
}

export interface AudioNormalizationConfig {
  readonly mode: AudioNormalizationMode;
  readonly codec: AudioOutputCodec;
  readonly downmixStereo: boolean;
}

export interface MediaProbeSummary {
  readonly formatName: string;
  readonly durationSeconds: number;
  readonly sizeBytes: number;
  readonly bitrateBps: number;
  readonly videoStreams: readonly VideoStreamInfo[];
  readonly audioStreams: readonly AudioStreamInfo[];
  readonly subtitleStreams: readonly SubtitleStreamInfo[];
  readonly audioAnalysis?: readonly AudioTrackAnalysis[];
}

export interface ExternalSubtitleFile {
  readonly path: string;
  readonly relativePath: string;
  readonly extension: string;
  readonly language: Iso639_2Code;
  readonly isForced: boolean;
  readonly isHearingImpaired: boolean;
  readonly isLanguageAmbiguous: boolean;
  readonly idxPairPath?: string;
  readonly missingIdxWarning?: string;
}

export interface MetadataCandidate {
  readonly title: string;
  readonly year?: number;
  readonly imdbId?: ImdbId;
  readonly tvdbId?: TvdbId;
  readonly tmdbId?: TmdbId;
  readonly overview?: string;
  readonly isAnimated?: boolean;
  readonly source: MetadataCandidateSource;
}

export interface ItemPatch {
  readonly mediaKind?: MediaKind;
  readonly category?: OutputCategory;
  readonly edition?: string;
  readonly include?: boolean;
  readonly selectedMetadata?: MetadataCandidate;
  readonly episodeOrder?: EpisodeOrderMode;
  readonly trackSelection?: TrackSelection;
  readonly audioNormalization?: AudioNormalizationConfig;
}

export interface EpisodeInfo {
  readonly seasonNumber: number;
  readonly episodeStart: number;
  readonly episodeEnd?: number;
  readonly airDate?: string;
  readonly episodeTitle?: string;
  readonly splitPart?: string;
}

export interface TrackSelection {
  readonly audioTracks: readonly {
    readonly streamOrder: number;
    readonly include: boolean;
    readonly language: Iso639_2Code;
    readonly isDefault: boolean;
  }[];
  readonly subtitleMergeMode: SubtitleMergeMode;
  readonly includedInternalSubtitles: readonly number[];
  readonly externalSubtitleOrder: readonly string[];
  readonly needsUserPrompt: boolean;
  readonly promptReason?: string;
  readonly audioNormalization?: AudioNormalizationConfig;
}

export interface ScannedItem {
  readonly id: ItemId;
  readonly sourcePath: string;
  readonly relativePath: string;
  readonly fileName: string;
  readonly mediaKind: MediaKind;
  readonly category: OutputCategory;
  readonly include: boolean;
  readonly parsedTitle: string;
  readonly parsedYear?: number;
  readonly edition?: string;
  readonly tags: readonly string[];
  readonly splitPart?: string;
  readonly episode?: EpisodeInfo;
  readonly probe: MediaProbeSummary;
  readonly externalSubtitles: readonly ExternalSubtitleFile[];
  readonly candidates: readonly MetadataCandidate[];
  readonly selectedMetadata?: MetadataCandidate;
  readonly episodeOrder: EpisodeOrderMode;
  readonly trackSelection: TrackSelection;
  readonly warnings: readonly string[];
  readonly projectedDestination?: string;
}

export interface ConflictComparison {
  readonly itemId: ItemId;
  readonly sourceFileName?: string;
  readonly kind: ConflictKind;
  readonly destinationPath: string;
  readonly existingPath?: string;
  readonly displayPath?: string;
  readonly incoming: MediaProbeSummary;
  readonly existing?: MediaProbeSummary;
  readonly collidingItemIds?: readonly ItemId[];
  readonly decision?: ConflictDecision;
}

export interface DiskSpaceCheck {
  readonly category: OutputCategory;
  readonly targetRoot: string;
  readonly availableBytes: number;
  readonly requiredBytes: number;
  readonly sufficient: boolean;
}

export type JobStageKind = (typeof JOB_STAGE_KINDS)[number];

export interface ActiveJobProgress {
  readonly jobId: JobId;
  readonly totalItems: number;
  readonly completedItems: number;
  readonly currentItemId?: ItemId;
  readonly currentFile?: string;
  readonly currentPercent: number;
  readonly stage?: JobStageKind;
  readonly stageLabel?: string;
  readonly etaSeconds?: number;
}

export interface BulkItemPatchRequest {
  readonly revision: number;
  readonly itemIds: readonly ItemId[];
  readonly patch: ItemPatch;
}

export type MountPathsMap = Readonly<Record<OutputCategory, string>> & {
  readonly inputDir: string;
};

export type VerifierEntryId = Brand<string, 'VerifierEntryId'>;

export function asVerifierEntryId(value: string): VerifierEntryId {
  return value as VerifierEntryId;
}

export type VerifierIssueCode =
  | 'EMPTY_DIRECTORY'
  | 'MISSING_YEAR'
  | 'MISSING_PROVIDER_ID'
  | 'NON_STANDARD_SEASON_DIR'
  | 'NON_STANDARD_FILENAME'
  | 'SUBTITLE_STEM_MISMATCH'
  | 'UNRESOLVED_METADATA';

export type VerifierRenameKind = 'file' | 'season-dir' | 'root-dir' | 'delete-dir';

export interface VerifierRenameStep {
  readonly kind: VerifierRenameKind;
  readonly fromRelative: string;
  readonly toRelative: string;
}

export interface VerifierEntry {
  readonly id: VerifierEntryId;
  readonly category: OutputCategory;
  readonly mediaKind: MediaKind;
  readonly currentRootName: string;
  readonly expectedRootName: string;
  readonly issues: readonly VerifierIssueCode[];
  readonly steps: readonly VerifierRenameStep[];
  readonly providerTag?: string;
  readonly resolvedTitle?: string;
  readonly resolvedYear?: number;
}

export interface VerifierSummary {
  readonly librariesScanned: number;
  readonly totalRootsAnalyzed: number;
  readonly totalSeasonDirsAnalyzed: number;
  readonly totalFilesAnalyzed: number;
  readonly compliantRoots: number;
  readonly issueCount: number;
  readonly scannedAt: string;
}

export interface VerifierProgress {
  readonly completed: number;
  readonly total: number;
  readonly percent: number;
  readonly stageLabel: string;
  readonly currentFile?: string;
  readonly etaSeconds?: number;
}

export interface VerifierState {
  readonly scanning: boolean;
  readonly fixing: boolean;
  readonly progress?: VerifierProgress | null;
  readonly summary: VerifierSummary | null;
  readonly entries: readonly VerifierEntry[];
  readonly lastFixResult?: {
    readonly renamedFiles: number;
    readonly renamedDirs: number;
    readonly errors: readonly string[];
  } | null;
}

export interface OrganizerStatePayload {
  readonly phase: JobPhase;
  readonly revision: number;
  readonly lockOwnerClientId: ClientId | null;
  readonly mountPaths: MountPathsMap;
  readonly items: readonly ScannedItem[];
  readonly activeJob: ActiveJobProgress | null;
  readonly lastError?: string | null;
  readonly logs?: readonly SseLogEvent[];
  readonly verifier?: VerifierState;
  readonly preferredLanguages?: readonly MetadataLanguageCode[];
}

export interface SseProgressEvent {
  readonly jobId: JobId;
  readonly itemId?: ItemId;
  readonly currentFile?: string;
  readonly totalItems?: number;
  readonly completedItems?: number;
  readonly percent: number;
  readonly stage?: JobStageKind;
  readonly stageLabel?: string;
  readonly etaSeconds?: number;
}

export interface SseLogEvent {
  readonly level: LogLevel;
  readonly message: string;
  readonly timestamp: string;
}

export type MetadataLanguageCode = (typeof METADATA_LANGUAGE_CODES)[number];
export type MetadataProviderId = 'imdb' | 'omdb' | 'tvdb' | 'tvmaze';

export type MetadataFailureKind =
  | 'provider_down'
  | 'rate_limited'
  | 'auth_failed'
  | 'schema_incompatible';

export interface MetadataDiagnostic {
  readonly provider: MetadataProviderId;
  readonly kind: MetadataFailureKind;
  readonly message: string;
  readonly statusCode?: number;
}

export interface MetadataLookupOptions {
  readonly onDiagnostic?: (diagnostic: MetadataDiagnostic) => void;
  readonly onLog?: (level: LogLevel, message: string) => void;
  readonly throwOnFailure?: boolean;
  readonly preferredLanguages?: readonly MetadataLanguageCode[];
}
