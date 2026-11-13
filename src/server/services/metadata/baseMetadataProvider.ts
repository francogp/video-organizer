import { setTimeout as delay } from 'node:timers/promises';

import {
  METADATA_MAX_RETRIES,
  METADATA_RETRY_BASE_MS,
  METADATA_RETRY_MAX_MS
} from '../../../domain/constants.ts';
import type {
  LogLevel,
  MetadataDiagnostic,
  MetadataFailureKind,
  MetadataLookupOptions,
  MetadataProviderId
} from '../../../domain/types.ts';
import { getCachedMetadata, setCachedMetadata, type MetadataCacheBucket } from './metadataCache.ts';

export type RateLimitStrategy =
  | { readonly kind: 'interval'; readonly minIntervalMs: number }
  | { readonly kind: 'slidingWindow'; readonly maxRequests: number; readonly windowMs: number };

export interface ProviderRuntimeConfig {
  readonly providerId: MetadataProviderId;
  readonly displayName: string;
  readonly parserFile: string;
  readonly rateLimit: RateLimitStrategy;
  readonly now?: () => number;
  readonly delayFn?: (ms: number) => Promise<void>;
  readonly throttleCustomFetch?: boolean;
}

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_BAD_GATEWAY = 502;
const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_GATEWAY_TIMEOUT = 504;
const MIN_DELAY_MS = 10;
const SECONDS_TO_MS = 1000;

const RETRYABLE_STATUS_CODES = new Set<number>([
  HTTP_TOO_MANY_REQUESTS,
  HTTP_BAD_GATEWAY,
  HTTP_SERVICE_UNAVAILABLE,
  HTTP_GATEWAY_TIMEOUT
]);

const ANIMATION_KEYWORDS = new Set(['animation', 'anime', 'animated']);

/** Returns true when provider genres or show type indicate animation/anime content. */
export function hasAnimationMetadata(genres: unknown, showType?: unknown): boolean {
  if (typeof showType === 'string' && ANIMATION_KEYWORDS.has(showType.trim().toLowerCase())) {
    return true;
  }
  if (typeof genres === 'string') {
    return genres.split(',').some((part) => ANIMATION_KEYWORDS.has(part.trim().toLowerCase()));
  }
  if (Array.isArray(genres)) {
    return genres.some((entry) => {
      if (typeof entry === 'string') {
        return ANIMATION_KEYWORDS.has(entry.trim().toLowerCase());
      }
      if (entry && typeof entry === 'object') {
        const name = Reflect.get(entry, 'name');
        const slug = Reflect.get(entry, 'slug');
        return (
          (typeof name === 'string' && ANIMATION_KEYWORDS.has(name.trim().toLowerCase())) ||
          (typeof slug === 'string' && ANIMATION_KEYWORDS.has(slug.trim().toLowerCase()))
        );
      }
      return false;
    });
  }
  return false;
}

/** Typed metadata provider error distinguishing outages, auth errors, rate limits, and parser schema drift. */
export class MetadataProviderError extends Error {
  public readonly provider: MetadataProviderId;
  public readonly kind: MetadataFailureKind;
  public readonly statusCode?: number;

  public constructor(
    provider: MetadataProviderId,
    kind: MetadataFailureKind,
    message: string,
    statusCode?: number
  ) {
    super(message);
    this.name = 'MetadataProviderError';
    this.provider = provider;
    this.kind = kind;
    this.statusCode = statusCode;
  }

  public toDiagnostic(): MetadataDiagnostic {
    return {
      provider: this.provider,
      kind: this.kind,
      message: this.message,
      statusCode: this.statusCode
    };
  }
}

function parseRetryAfterMs(headerValue: string | null, nowMs: number): number | undefined {
  if (!headerValue) {
    return undefined;
  }
  const seconds = Number(headerValue.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(METADATA_RETRY_MAX_MS, Math.round(seconds * SECONDS_TO_MS));
  }
  try {
    const parsedEpoch = Temporal.Instant.from(headerValue.trim()).epochMilliseconds;
    return Math.min(METADATA_RETRY_MAX_MS, Math.max(0, parsedEpoch - nowMs));
  } catch {
    return undefined;
  }
}

function computeBackoffMs(attempt: number): number {
  return Math.min(METADATA_RETRY_MAX_MS, METADATA_RETRY_BASE_MS * 2 ** attempt);
}

/**
 * Single base class encapsulating serialized rate limiting, HTTP retries, JSON/schema validation,
 * persistent caching, and actionable error reporting for all metadata providers.
 */
export abstract class BaseMetadataProvider {
  public readonly providerId: MetadataProviderId;
  public readonly displayName: string;
  public readonly parserFile: string;
  readonly #rateLimit: RateLimitStrategy;
  readonly #now: () => number;
  readonly #delayFn: (ms: number) => Promise<void>;
  readonly #throttleCustomFetch: boolean;

  #slotQueue: Promise<void> = Promise.resolve();
  #lastRequestAt = 0;
  readonly #windowTimestamps: number[] = [];

  protected constructor(config: ProviderRuntimeConfig) {
    this.providerId = config.providerId;
    this.displayName = config.displayName;
    this.parserFile = config.parserFile;
    this.#rateLimit = config.rateLimit;
    this.#now = config.now ?? (() => performance.now());
    this.#delayFn = config.delayFn ?? ((ms) => delay(ms));
    this.#throttleCustomFetch = config.throttleCustomFetch ?? false;
  }

  /** Reserves a rate-limit slot strictly sequentially across concurrent callers. */
  protected async acquireSlot(fetchImpl: typeof fetch): Promise<void> {
    if (fetchImpl !== fetch && !this.#throttleCustomFetch) {
      return;
    }

    const reservation = this.#slotQueue.then(async () => {
      if (this.#rateLimit.kind === 'interval') {
        const elapsed = this.#now() - this.#lastRequestAt;
        if (this.#lastRequestAt > 0 && elapsed < this.#rateLimit.minIntervalMs) {
          await this.#delayFn(this.#rateLimit.minIntervalMs - elapsed);
        }
        this.#lastRequestAt = this.#now();
        return;
      }

      const { maxRequests, windowMs } = this.#rateLimit;
      const prune = (now: number): void => {
        while (
          this.#windowTimestamps.length > 0 &&
          now - (this.#windowTimestamps[0] ?? 0) >= windowMs
        ) {
          this.#windowTimestamps.shift();
        }
      };

      prune(this.#now());
      if (this.#windowTimestamps.length >= maxRequests) {
        const oldest = this.#windowTimestamps[0] ?? this.#now();
        const waitMs = Math.max(MIN_DELAY_MS, windowMs - (this.#now() - oldest));
        await this.#delayFn(waitMs);
        prune(this.#now());
      }
      this.#windowTimestamps.push(this.#now());
    });

    this.#slotQueue = reservation.then(undefined, (err: unknown) => {
      console.warn('Metadata rate-limit queue error:', err);
    });
    await reservation;
  }

  protected schemaError(detail: string, statusCode?: number): MetadataProviderError {
    return new MetadataProviderError(
      this.providerId,
      'schema_incompatible',
      `${this.displayName} response format changed and is no longer compatible with this parser (${detail}). Source code update required in ${this.parserFile}.`,
      statusCode
    );
  }

  protected providerDownError(detail: string, statusCode?: number): MetadataProviderError {
    return new MetadataProviderError(
      this.providerId,
      'provider_down',
      `${this.displayName} appears to be down or unreachable (${detail}).`,
      statusCode
    );
  }

  protected authFailedError(statusCode: number): MetadataProviderError {
    return new MetadataProviderError(
      this.providerId,
      'auth_failed',
      `${this.displayName} authentication failed (HTTP ${String(statusCode)}). Verify your API key in configuration.`,
      statusCode
    );
  }

  protected rateLimitedError(statusCode: number): MetadataProviderError {
    return new MetadataProviderError(
      this.providerId,
      'rate_limited',
      `${this.displayName} rate limit exceeded (HTTP ${String(statusCode)}) after retries.`,
      statusCode
    );
  }

  protected assertRecord(value: unknown, context: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw this.schemaError(`expected JSON object for ${context}`);
    }
    return value as Record<string, unknown>;
  }

  protected assertArray(value: unknown, context: string): readonly unknown[] {
    if (!Array.isArray(value)) {
      throw this.schemaError(`expected JSON array for ${context}`);
    }
    return value;
  }

  async #retryDelay(ms: number, fetchImpl: typeof fetch): Promise<void> {
    if (fetchImpl !== fetch && !this.#throttleCustomFetch) {
      return;
    }
    await this.#delayFn(ms);
  }

  /** Executes an HTTP JSON request with serialized rate limiting, retries, and schema validation. */
  protected async fetchAndParse<T>(
    url: string,
    init: RequestInit | undefined,
    parseFn: (raw: unknown) => T,
    fetchImpl: typeof fetch,
    requestOptions?: {
      readonly onNotFound?: () => T;
      readonly onLog?: (level: LogLevel, message: string) => void;
    }
  ): Promise<T> {
    for (let attempt = 0; attempt <= METADATA_MAX_RETRIES; attempt += 1) {
      await this.acquireSlot(fetchImpl);

      let res: Response;
      try {
        res = await fetchImpl(url, init);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt < METADATA_MAX_RETRIES) {
          const waitMs = computeBackoffMs(attempt);
          requestOptions?.onLog?.(
            'warn',
            `${this.displayName}: network error (${msg}) — retrying in ${String(waitMs)}ms (attempt ${String(attempt + 1)}/${String(METADATA_MAX_RETRIES)})...`
          );
          await this.#retryDelay(waitMs, fetchImpl);
          continue;
        }
        throw this.providerDownError(msg);
      }

      if (res.status === HTTP_UNAUTHORIZED || res.status === HTTP_FORBIDDEN) {
        throw this.authFailedError(res.status);
      }

      if (res.status === HTTP_NOT_FOUND && requestOptions?.onNotFound) {
        return requestOptions.onNotFound();
      }

      if (RETRYABLE_STATUS_CODES.has(res.status)) {
        if (attempt < METADATA_MAX_RETRIES) {
          const retryAfterMs =
            res.status === HTTP_TOO_MANY_REQUESTS
              ? parseRetryAfterMs(
                  res.headers.get('retry-after'),
                  Temporal.Now.instant().epochMilliseconds
                )
              : undefined;
          const waitMs = retryAfterMs ?? computeBackoffMs(attempt);
          requestOptions?.onLog?.(
            'warn',
            `${this.displayName}: HTTP ${String(res.status)} — retrying in ${String(waitMs)}ms (attempt ${String(attempt + 1)}/${String(METADATA_MAX_RETRIES)})...`
          );
          await this.#retryDelay(waitMs, fetchImpl);
          continue;
        }
        if (res.status === HTTP_TOO_MANY_REQUESTS) {
          throw this.rateLimitedError(res.status);
        }
        throw this.providerDownError(`HTTP ${String(res.status)}`, res.status);
      }

      if (!res.ok) {
        throw this.providerDownError(`HTTP ${String(res.status)}`, res.status);
      }

      if (attempt > 0) {
        requestOptions?.onLog?.(
          'info',
          `${this.displayName}: retry succeeded on attempt ${String(attempt + 1)}.`
        );
      }

      const rawText = await res.text();
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(rawText);
      } catch {
        const snippet = rawText.trim().slice(0, 40).toLowerCase();
        if (snippet.startsWith('<!doctype') || snippet.startsWith('<html')) {
          throw this.schemaError(
            'received HTML instead of JSON (endpoint may have changed or returned a web challenge)',
            res.status
          );
        }
        throw this.schemaError('response body is not valid JSON', res.status);
      }

      return parseFn(parsedJson);
    }

    throw this.providerDownError('exhausted retry attempts');
  }

  /** Reads/writes persistent cache only when using global `fetch` and never caches failures. */
  protected async withCache<K extends MetadataCacheBucket, T>(
    bucket: K,
    key: string,
    fetchImpl: typeof fetch,
    toCacheValue: (result: T) => NonNullable<ReturnType<typeof getCachedMetadata<K>>>,
    fromCacheValue: (cached: NonNullable<ReturnType<typeof getCachedMetadata<K>>>) => T,
    loader: () => Promise<T>
  ): Promise<T> {
    if (fetchImpl === fetch) {
      const hit = getCachedMetadata(bucket, key);
      if (hit !== undefined) {
        return fromCacheValue(hit);
      }
    }
    const result = await loader();
    if (fetchImpl === fetch) {
      setCachedMetadata(bucket, key, toCacheValue(result));
    }
    return result;
  }
}

export interface ProviderChainStep<T> {
  readonly run: () => Promise<T>;
  readonly hasResult?: (value: T) => boolean;
}

/**
 * Executes a prioritized list of provider steps with fallback, emitting diagnostics for any
 * failed step and optionally throwing the final error when all providers fail.
 */
export async function runProviderChain<T>(
  steps: readonly ProviderChainStep<T>[],
  fallbackValue: T,
  options?: MetadataLookupOptions
): Promise<T> {
  let lastError: MetadataProviderError | undefined;

  for (const step of steps) {
    try {
      const value = await step.run();
      if (step.hasResult ? step.hasResult(value) : true) {
        return value;
      }
    } catch (err) {
      if (err instanceof MetadataProviderError) {
        lastError = err;
        options?.onDiagnostic?.(err.toDiagnostic());
        continue;
      }
      throw err;
    }
  }

  if (lastError && options?.throwOnFailure) {
    throw lastError;
  }
  return fallbackValue;
}
