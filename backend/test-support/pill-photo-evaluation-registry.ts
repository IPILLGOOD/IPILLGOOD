import {
  loadPillPhotoEvaluationFixture,
  PILL_PHOTO_EVALUATION_VERSION,
} from "./pill-photo-evaluation.ts";
import type { ReviewedPillPhotoSet } from "../src/pill-photo-experiment.ts";
import type { ExpectedPillPhotoProduct } from "./pill-photo-label-audit.ts";
import {
  loadPillPhotoUnseenEvaluationFixture,
  PILL_PHOTO_UNSEEN_EVALUATION_VERSION,
} from "./pill-photo-unseen-evaluation.ts";
import {
  loadPillPhotoPhoneHoldoutFixture,
  loadPillPhotoPhoneValidationFixture,
  PILL_PHOTO_PHONE_HOLDOUT_VERSION,
  PILL_PHOTO_PHONE_VALIDATION_VERSION,
} from "./pill-photo-phone-validation.ts";

export const PILL_PHOTO_EVALUATION_FIXTURES = {
  v2: PILL_PHOTO_EVALUATION_VERSION,
  v3: PILL_PHOTO_UNSEEN_EVALUATION_VERSION,
  v4: PILL_PHOTO_PHONE_VALIDATION_VERSION,
  v5: PILL_PHOTO_PHONE_HOLDOUT_VERSION,
} as const;
export type PillPhotoEvaluationFixtureKey = keyof typeof PILL_PHOTO_EVALUATION_FIXTURES;
export type PillPhotoEvaluationSplit = "validation" | "holdout";

export interface RegisteredPillPhotoEvaluationFixture {
  key: PillPhotoEvaluationFixtureKey;
  fixtureVersion: string;
  catalogFixtureVersion: string;
  scope: { claim: string };
  products: ExpectedPillPhotoProduct[];
  images: Array<{ path: string; officialSide: "front" | "back"; sha256: string }>;
  cases: Array<{
    id: string;
    split: PillPhotoEvaluationSplit;
    expectedItemSeq: string;
    photos: string[];
  }>;
  inferenceInputs: Array<{
    id: string;
    split: PillPhotoEvaluationSplit;
    photos: string[];
  }>;
  photoSet: Exclude<ReviewedPillPhotoSet, "development">;
  preprocessing: "public_alpha_mask" | "phone_centered";
}

export function parsePillPhotoEvaluationFixtureKey(value: string | undefined): PillPhotoEvaluationFixtureKey {
  if (value === undefined || value === "v2") return "v2";
  if (value === "v3") return "v3";
  if (value === "v4") return "v4";
  if (value === "v5") return "v5";
  throw new Error("invalid_fixture");
}

function commonFixture(
  key: PillPhotoEvaluationFixtureKey,
  source: {
    fixtureVersion: string;
    catalogFixtureVersion: string;
    scope: { claim: string };
    products: ExpectedPillPhotoProduct[];
    images: Array<{ path: string; officialSide: "front" | "back"; sha256: string }>;
    cases: Array<{ id: string; split: PillPhotoEvaluationSplit; expectedItemSeq: string; photos: string[] }>;
  },
  inferenceInputs: RegisteredPillPhotoEvaluationFixture["inferenceInputs"],
  photoSet: RegisteredPillPhotoEvaluationFixture["photoSet"],
  preprocessing: RegisteredPillPhotoEvaluationFixture["preprocessing"],
): RegisteredPillPhotoEvaluationFixture {
  return {
    key,
    fixtureVersion: source.fixtureVersion,
    catalogFixtureVersion: source.catalogFixtureVersion,
    scope: { claim: source.scope.claim },
    products: source.products,
    images: source.images,
    cases: source.cases,
    inferenceInputs,
    photoSet,
    preprocessing,
  };
}

async function loadV2Fixture(): Promise<RegisteredPillPhotoEvaluationFixture> {
  const { manifest, inferenceInputs } = await loadPillPhotoEvaluationFixture();
  return commonFixture("v2", {
    ...manifest,
    products: manifest.products.map((product) => ({ ...product })),
    images: manifest.images.map(({ path, officialSide, sha256 }) => ({ path, officialSide, sha256 })),
    cases: manifest.cases.map(({ id, split, expectedItemSeq, photos }) => ({ id, split, expectedItemSeq, photos })),
  }, inferenceInputs, "evaluation", "public_alpha_mask");
}

async function loadV3Fixture(): Promise<RegisteredPillPhotoEvaluationFixture> {
  const { manifest, inferenceInputs } = await loadPillPhotoUnseenEvaluationFixture();
  return commonFixture("v3", {
    ...manifest,
    products: manifest.products.map((product) => ({
      receipt: product.sourceGroup,
      expectedItemSeq: product.expectedItemSeq,
      mappingEvidenceUrl: product.mappingEvidenceUrl,
      expectedOfficialRecordSha256: product.expectedOfficialRecordSha256,
      expectedObservation: product.expectedObservation,
    })),
    images: manifest.images.map(({ path, officialSide, sha256 }) => ({ path, officialSide, sha256 })),
    cases: manifest.cases.map(({ id, split, expectedItemSeq, photos }) => ({ id, split, expectedItemSeq, photos })),
  }, inferenceInputs, "unseen_evaluation", "public_alpha_mask");
}

async function loadPhoneFixture(key: "v4" | "v5"): Promise<RegisteredPillPhotoEvaluationFixture> {
  const { manifest, inferenceInputs } = key === "v4"
    ? await loadPillPhotoPhoneValidationFixture()
    : await loadPillPhotoPhoneHoldoutFixture();
  return commonFixture(key, {
    ...manifest,
    products: manifest.products.map((product) => ({
      receipt: product.id,
      expectedItemSeq: product.expectedItemSeq,
      mappingEvidenceUrl: product.appearanceHistory?.identificationHistoryUrl ?? null,
      expectedOfficialRecordSha256: product.expectedOfficialRecordSha256,
      expectedObservation: {
        form: product.expectedObservation.form,
        shape: product.expectedObservation.shape,
        colors: product.expectedObservation.colors,
        frontImprint: product.expectedObservation.front.imprint,
        backImprint: product.expectedObservation.back.imprint,
      },
    })),
    images: manifest.images.map(({ path, officialSide, sha256 }) => ({ path, officialSide, sha256 })),
    cases: manifest.cases.map(({ id, split, expectedItemSeq, photos }) => ({ id, split, expectedItemSeq, photos })),
  }, inferenceInputs, key === "v4" ? "phone_validation" : "phone_holdout", "phone_centered");
}

export async function loadRegisteredPillPhotoEvaluationFixture(
  key: PillPhotoEvaluationFixtureKey,
): Promise<RegisteredPillPhotoEvaluationFixture> {
  if (key === "v5" || key === "v4") return loadPhoneFixture(key);
  return key === "v3" ? loadV3Fixture() : loadV2Fixture();
}
