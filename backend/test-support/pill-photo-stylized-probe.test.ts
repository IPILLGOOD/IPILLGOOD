import test from "node:test";
import assert from "node:assert/strict";
import { PILL_PHOTO_STRUCTURED_INSTRUCTIONS } from "../src/pill-photo-prompt-profiles.ts";
import { pillObservation, observedSide, pillEnvelope, pillRecord } from "./pill-fixtures.ts";
import { pillPhotoFeaturesSchema } from "../src/pill-photo-features.ts";
import { parseOfficialPillPage } from "../src/official-pill-catalog.ts";
import { inspectPillFeatures } from "./pill-photo-vision-fields.ts";
import { buildVisionProbeRequests, requestVisionProbe, executeVisionProbeOrder, visionProbeOrder,
  STYLIZED_TEXT_ADDITION, STYLIZED_TEXT_INSTRUCTIONS } from "./pill-photo-stylized-probe.ts";
import { parseStylizedProbeArgs, summarizeStylizedProbe } from "../scripts/pill-photo-stylized-probe.ts";

function fixtures() {
  const png = Buffer.from([137,80,78,71,13,10,26,10]); // Unit request builder only, not a reviewed file fixture.
  const bodies = buildVisionProbeRequests([png,png,png,png]);
  const { source, ...observation } = pillObservation({ front: observedSide("UV", "none"), back: observedSide("RQ", "none") });
  assert.equal(source, "manual");
  const features = pillPhotoFeaturesSchema.parse({ observation, pairConsistency: "consistent", bothSidesVisible: true, imageArtifact: "none" });
  const raw = { id: "resp_test", model: "gpt-5.6-sol", status: "completed", usage: { input_tokens: 12, output_tokens: 4 },
    output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(features) }] }] };
  return { bodies, features, raw };
}
test("지시 한 문단 외 요청·이미지·모델·추론·출력 계약은 동일하고 정답 정보를 넣지 않는다", () => {
  const { bodies } = fixtures();
  assert.equal(STYLIZED_TEXT_INSTRUCTIONS.replace(`\n${STYLIZED_TEXT_ADDITION}`, ""), PILL_PHOTO_STRUCTURED_INSTRUCTIONS);
  assert.deepEqual({ ...bodies.structured_control, instructions: "" }, { ...bodies.stylized_text, instructions: "" });
  assert.equal(bodies.stylized_text.model, "gpt-5.6-sol"); assert.deepEqual(bodies.stylized_text.reasoning, { effort: "low" });
  assert.equal(bodies.stylized_text.store, false);
  assert.doesNotMatch(JSON.stringify(bodies), /expectedItemSeq|expectedObservation|verification-artifacts|v4-v0/);
  assert.throws(() => buildVisionProbeRequests([]), /probe_images_invalid/);
});
test("모의 전송은 고정 endpoint·redirect 금지·원문과 usage를 보존하며 응답마다 한 번만 요청한다", async () => {
  const { bodies, raw } = fixtures(); let calls = 0;
  const result = await requestVisionProbe(bodies.stylized_text, "fake-local-key", async (url, init) => {
    calls++; assert.equal(url, "https://api.openai.com/v1/responses"); assert.equal(init?.redirect, "error");
    assert.equal(init?.body, JSON.stringify(bodies.stylized_text));
    return new Response(JSON.stringify(raw), { headers: { "content-type": "application/json", "x-request-id": "req_test" } });
  });
  assert.equal(calls, 1); assert.deepEqual(result.raw, raw); assert.equal(result.trace.requestId, "req_test");
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 4 });
  assert.doesNotMatch(JSON.stringify(result), /fake-local-key/);
});
test("HTTP·파싱·크기·미완료·형식 오류는 무재시도 실패이며 키 없음은 요청 전 거절한다", async () => {
  const { bodies } = fixtures(); let calls = 0;
  for (const response of [
    new Response("denied", { status: 403 }), new Response("{}", { headers: { "content-type": "text/plain" } }),
    new Response("{}", { headers: { "content-type": "application/json", "content-length": "1048577" } }),
    new Response("{", { headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify({ status: "incomplete" }), { headers: { "content-type": "application/json" } }),
    new Response(" ".repeat(1048577), { headers: { "content-type": "application/json" } }),
  ]) {
    const before = calls;
    await assert.rejects(requestVisionProbe(bodies.structured_control, "fake", async () => { calls++; return response; }));
    assert.equal(calls - before, 1);
  }
  await assert.rejects(requestVisionProbe(bodies.structured_control, "", async () => { throw Error("must_not_request"); }), /probe_request_invalid/);
});
test("순서는 정확히 6제품×3회×2조건이며 쌍마다 순서를 교차하고 실패 후 요청하지 않는다", async () => {
  const order = visionProbeOrder(); assert.equal(order.length, 36);
  for (let index = 0; index < order.length; index += 2) {
    assert.equal(order[index]!.id, order[index + 1]!.id); assert.notEqual(order[index]!.arm, order[index + 1]!.arm);
  }
  assert.equal(order.filter(task => task.arm === "stylized_text").length, 18);
  let calls = 0;
  await assert.rejects(executeVisionProbeOrder(async () => { if (++calls === 5) throw Error("failure"); }), /failure/);
  assert.equal(calls, 5);
});
test("불완전·선별·순서 변경 결과는 성공 요약이 될 수 없고 순위 손실·안전 위반은 개선 판정을 막는다", async () => {
  const { features, bodies, raw } = fixtures();
  const vision = await requestVisionProbe(bodies.structured_control, "fake", async () => new Response(JSON.stringify(raw), { headers: { "content-type": "application/json" } }));
  const page = parseOfficialPillPage(pillEnvelope([pillRecord({ PRINT_FRONT: "UV", PRINT_BACK: "RQ" })]), "json", "2026-09-01T00:00:00.000Z");
  const score = inspectPillFeatures(features, page.items[0]!.itemSeq, { ...page, completeness: "complete", version: "synthetic" });
  const rows = visionProbeOrder().map(task => ({ task, vision, scores: [structuredClone(score), structuredClone(score)] }));
  assert.throws(() => summarizeStylizedProbe(rows.slice(1)), /probe_incomplete/);
  assert.throws(() => summarizeStylizedProbe([...rows].reverse()), /probe_incomplete/);
  assert.equal(summarizeStylizedProbe(rows).conditionalSignal, "no_clear_gain");
  const before = rows.find(row => row.task.arm === "structured_control")!;
  for (const score of before.scores) score.expectedRank = 2;
  assert.equal(summarizeStylizedProbe(rows).conditionalSignal, "promising_requires_fresh_full_pipeline");
  rows.find(row => row.task.arm === "stylized_text")!.scores[0]!.strongWrongCandidates = 1;
  assert.equal(summarizeStylizedProbe(rows).conditionalSignal, "no_clear_gain");
  rows.find(row => row.task.arm === "stylized_text")!.scores[0]!.strongWrongCandidates = 0;
  const negative = structuredClone(rows);
  negative.find(row => row.task.arm === "stylized_text")!.scores[1]!.expectedRank = null;
  assert.equal(summarizeStylizedProbe(negative).conditionalSignal, "no_clear_gain", "secondary OCR loss blocks promotion");
  negative.find(row => row.task.arm === "stylized_text")!.scores[1]!.expectedRank = 1;
  negative.find(row => row.task.arm === "stylized_text")!.scores[1]!.retakeCandidateExposure = true;
  assert.equal(summarizeStylizedProbe(negative).conditionalSignal, "no_clear_gain", "retake exposure blocks promotion");
  const repeatLoss = structuredClone(rows);
  for (const row of repeatLoss) for (const score of row.scores) score.expectedRank = 2;
  repeatLoss.find(row => row.task.arm === "stylized_text")!.scores[0]!.expectedRank = 1;
  // Recall@5 totals tie (16/18), but the candidate concentrates two misses in one repeat:
  // control 5/5/6 vs candidate 4/6/6.
  for (const source of [0,1]) {
    repeatLoss.find(row => row.task.arm === "structured_control" && row.task.repetition === 1)!.scores[source]!.expectedRank = null;
    repeatLoss.find(row => row.task.arm === "structured_control" && row.task.repetition === 2)!.scores[source]!.expectedRank = null;
    repeatLoss.filter(row => row.task.arm === "stylized_text" && row.task.repetition === 1).slice(-2)
      .forEach(row => { row.scores[source]!.expectedRank = null; });
  }
  assert.equal(summarizeStylizedProbe(repeatLoss).conditionalSignal, "no_clear_gain", "minimum-repeat loss blocks promotion even when totals tie");
});
test("실제 호출에는 prepare와 별도로 명시적 validation 전송·plan 플래그가 필요하다", () => {
  const paths = ["--baseline", "a", "--candidate", "b", "--image-root", "c"];
  assert.equal(parseStylizedProbeArgs(["prepare", ...paths]).mode, "prepare");
  for (const suffix of [[], ["--live"], ["--live", "--plan", "p"], ["--holdout"], ["--model", "other"]]) {
    assert.throws(() => parseStylizedProbeArgs(["run", ...paths, ...suffix]));
  }
  assert.equal(parseStylizedProbeArgs(["run", ...paths, "--plan", "p", "--live", "--confirm-validation-transfer"]).mode, "run");
});
