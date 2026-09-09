import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCandidateReviewArgs } from "../scripts/pill-photo-candidate-review.ts";

test("candidate review CLI requires a fixed generated plan and explicit validation transfer; rejects holdout/model/arbitrary paths", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  assert.deepEqual(parseCandidateReviewArgs(["prepare"]), { mode: "prepare" });
  const path = "verification-artifacts/pill-photo-candidate-review/plan-example";
  assert.deepEqual(parseCandidateReviewArgs(["run", "--plan", path, "--allow-validation-transfer"]), { mode: "run", directory: resolve(root, path) });
  for (const args of [[], ["run"], ["--live"], ["prepare", "--model", "other"],
    ["run", "--plan", path], ["run", "--plan", path, "--allow-holdout-transfer"],
    ["run", "--plan", "verification-artifacts/pill-photo-v4-intake/holdout", "--allow-validation-transfer"],
    ["run", "--plan", "verification-artifacts/pill-photo-candidate-review/plan-x/../run-other", "--allow-validation-transfer"],
    ["run", "--plan", "../plan-outside", "--allow-validation-transfer"]]) assert.throws(() => parseCandidateReviewArgs(args));
});
