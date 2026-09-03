import assert from "node:assert/strict";
import test from "node:test";

import { normalizeExtractedMedicationCodes } from "./ai/openai-medical.ts";

test("모델이 한 보험코드를 두 필드에 복사해도 품목기준코드로 승격하지 않는다", () => {
  assert.deepEqual(
    normalizeExtractedMedicationCodes("650201700", "650201700"),
    { insuranceCode: "650201700" },
  );
});

test("서로 다른 품목기준코드와 보험코드는 각각 보존한다", () => {
  assert.deepEqual(
    normalizeExtractedMedicationCodes("200001234", "648900030"),
    { mfdsItemSeq: "200001234", insuranceCode: "648900030" },
  );
});
