import {
  loadPillPhotoEvaluationFixture,
  PILL_PHOTO_EVALUATION_VERSION,
} from "./pill-photo-evaluation.ts";
import {
  loadPillPhotoUnseenEvaluationFixture,
  PILL_PHOTO_UNSEEN_EVALUATION_VERSION,
} from "./pill-photo-unseen-evaluation.ts";

export const PILL_PHOTO_EVALUATION_FIXTURES = {
  v2: PILL_PHOTO_EVALUATION_VERSION,
  v3: PILL_PHOTO_UNSEEN_EVALUATION_VERSION,
} as const;
export type PillPhotoEvaluationFixtureKey = keyof typeof PILL_PHOTO_EVALUATION_FIXTURES;

export function parsePillPhotoEvaluationFixtureKey(value: string | undefined): PillPhotoEvaluationFixtureKey {
  if (value === undefined || value === "v2") return "v2";
  if (value === "v3") return "v3";
  throw new Error("invalid_fixture");
}

export function loadRegisteredPillPhotoEvaluationFixture(key: PillPhotoEvaluationFixtureKey) {
  return key === "v3" ? loadPillPhotoUnseenEvaluationFixture() : loadPillPhotoEvaluationFixture();
}
