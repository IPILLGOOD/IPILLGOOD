// Node.js + Sharp entry point. Deliberately excluded from the backend root/Workers entry.
// Callers own file IO, credentials, catalog loading/reuse, and any persisted results.
import { comparePillPhotoFeatures } from "./pill-photo-features.ts";
import type { PillCatalog } from "./pill-identification.ts";
import type { PillPhotoFailure } from "./pill-photo-failures.ts";
import {
  preparePhonePillPhotoRequests, extractPreparedPillPhotos,
  type PreparedPillPhotoRequests, type PhotoExtractionResult, type PillPhotoRequestTrace,
  type PillPhotoExecutionMode, type PillPhotoOcrImageCount,
} from "./pill-photo-pipeline.ts";

export type { PillCatalog } from "./pill-identification.ts";
export type { PillPhotoRequestTrace, PillPhotoExecutionMode, PillPhotoOcrImageCount } from "./pill-photo-pipeline.ts";

export interface PillPhotoAnalysisOptions {
  allowExternalTransfer?: boolean;
  apiKey?: string;
  /** The common entry defaults to parallel; existing reviewed tools retain their own defaults. */
  executionMode?: PillPhotoExecutionMode;
  fetchImpl?: typeof fetch;
  /** Redacted stage metadata only. A rejected observer prevents successful analysis. */
  onRequestTrace?: (event: PillPhotoRequestTrace) => Promise<void>;
}

export interface PillPhotoAnalysisInput extends PillPhotoAnalysisOptions {
  front: Uint8Array;
  back: Uint8Array;
  /** Already loaded/validated by the caller. Do not mutate it while analysis is running. */
  catalog: PillCatalog;
  model: string;
  ocrModel: string;
  ocrImageCount?: PillPhotoOcrImageCount;
}

export type PillPhotoComparison = ReturnType<typeof comparePillPhotoFeatures>;
export type PillPhotoAnalysisFailure = PillPhotoFailure | "analysis_failed";
export interface PillPhotoAnalysisTimings {
  preprocessingMs: number;
  analysisWallMs: number;
  searchMs: number;
}

type AnalysisMetadata = {
  schemaVersion: "pill-photo-analysis.v1";
  sourceSha256: string[] | null;
  preprocessing: PreparedPillPhotoRequests["preprocessing"] | null;
  timings: PillPhotoAnalysisTimings;
  /** Excludes caller-owned upload, catalog loading, and file persistence. */
  elapsedMs: number;
};

export type PillPhotoAnalysisResult = AnalysisMetadata & (
  | { ok: true; extraction: Extract<PhotoExtractionResult, { ok: true }>; comparison: PillPhotoComparison }
  | { ok: false; reason: PillPhotoAnalysisFailure; extraction: PhotoExtractionResult | null; comparison: null }
);

/**
 * Bytes -> preprocessing -> three AI requests -> fusion -> search.
 * No file paths, environment lookup, catalog fallback/cache or image persistence.
 * The result contains metadata/features/candidates, never image bytes or request bodies.
 * ok means analysis completed; comparison may still require review or a new photograph.
 */
export async function analyzePillPhotos(input: PillPhotoAnalysisInput): Promise<PillPhotoAnalysisResult> {
  const started = performance.now();
  const prepared = await preparePhonePillPhotoRequests([input.front, input.back], {
    model: input.model, ocrModel: input.ocrModel, ocrImageCount: input.ocrImageCount,
  });
  const preprocessingMs = Math.round(performance.now() - started);
  if (!prepared.ok) return {
    schemaVersion: "pill-photo-analysis.v1", ok: false, reason: prepared.reason,
    sourceSha256: null, preprocessing: null, extraction: null, comparison: null,
    timings: { preprocessingMs, analysisWallMs: 0, searchMs: 0 }, elapsedMs: preprocessingMs,
  };
  const result = await analyzePreparedPillPhotos(prepared, input.catalog, input);
  return { ...result, timings: { ...result.timings, preprocessingMs }, elapsedMs: Math.round(performance.now() - started) };
}

/**
 * Same analysis/search path for callers with a preparation checkpoint (the local CLI).
 * Preparation is not repeated. Its time is zero here; the caller accounts for that phase.
 * File-writing observers are optional and remain entirely caller-owned.
 */
export async function analyzePreparedPillPhotos(
  prepared: PreparedPillPhotoRequests,
  catalog: PillCatalog,
  options: PillPhotoAnalysisOptions = {},
): Promise<PillPhotoAnalysisResult> {
  const started = performance.now();
  const metadata = {
    schemaVersion: "pill-photo-analysis.v1" as const,
    sourceSha256: [...prepared.sourceSha256], preprocessing: structuredClone(prepared.preprocessing),
    timings: { preprocessingMs: 0, analysisWallMs: 0, searchMs: 0 },
  };
  let extraction: PhotoExtractionResult | null = null;
  try {
    const analysisStarted = performance.now();
    try {
      extraction = await extractPreparedPillPhotos(prepared, {
        allowExternalTransfer: options.allowExternalTransfer, apiKey: options.apiKey,
        executionMode: options.executionMode === undefined ? "parallel" : options.executionMode, fetchImpl: options.fetchImpl,
        onRequestTrace: options.onRequestTrace,
      });
    } finally { metadata.timings.analysisWallMs = Math.round(performance.now() - analysisStarted); }
    if (!extraction.ok) return {
      ...metadata, ok: false, reason: extraction.reason, extraction, comparison: null,
      elapsedMs: Math.round(performance.now() - started),
    };
    const searchStarted = performance.now();
    let comparison: PillPhotoComparison;
    try { comparison = comparePillPhotoFeatures(extraction.features, catalog); }
    finally { metadata.timings.searchMs = Math.round(performance.now() - searchStarted); }
    return { ...metadata, ok: true, extraction, comparison, elapsedMs: Math.round(performance.now() - started) };
  } catch {
    // Do not return exception messages, raw provider output, credentials or request bodies.
    return { ...metadata, ok: false, reason: "analysis_failed", extraction, comparison: null,
      elapsedMs: Math.round(performance.now() - started) };
  }
}
