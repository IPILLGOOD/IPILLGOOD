import assert from "node:assert/strict";
import test from "node:test";
import { publicArticleUrl, validateNutritionArticles, nutritionExplorationRequest } from "./nutrition-exploration.ts";
import { buildNutritionSearchPlan, NUTRITION_SEARCH_BUDGET, NUTRITION_SEARCH_INSTRUCTIONS } from "./ai/nutrition-exploration.ts";

const url = "https://blog.example/post";
const article = {
  url, title: "한국어 식사 기록", format: "blog", summary: "식사 준비 과정을 구체적으로 소개한 개인 기록입니다.",
  topic: "실천 경험", access: "content",
};
const validate = (items: unknown[], sources = [url], conditionName = "식사") => validateNutritionArticles({ articles: items }, sources, conditionName);

test("only grounded Korean articles survive; tracking duplicates are removed", () => {
  const result = validate([article, { ...article, url: `${url}?utm_source=test` }, { ...article, url: "https://blog.example/invented" }]);
  assert.equal(result.length, 1);
  assert.deepEqual(Object.keys(result[0]).sort(), ["format", "platform", "publisher", "summary", "title", "topic", "url", "verification"]);
});
test("results without Korean titles or summaries are excluded", () => {
  for (const field of ["title", "summary"]) assert.deepEqual(validate([{ ...article, [field]: "English only" }]), []);
});
test("malformed results do not fill the list", () => {
  for (const change of [{ access: "unavailable" }, { summary: null }]) {
    assert.deepEqual(validate([{ ...article, ...change }]), []);
  }
});
test("Naver search previews are labeled while indirect disease material is rejected", () => {
  const naver = { ...article, url: "https://blog.naver.com/test_blog/123456", access: "preview" };
  assert.equal(validate([naver], [naver.url])[0]?.verification, "preview");
  assert.deepEqual(validate([{ ...article, summary: "이 질환을 직접 다루는 자료는 아니지만 외식 방법을 설명합니다." }]), []);
});
test("YouTube requires a specific video URL", () => {
  const video = { ...article, format: "video", access: "preview", url: "https://youtu.be/abcdefghijk" };
  const result = validate([video], [video.url]);
  assert.equal(result[0].url, "https://www.youtube.com/watch?v=abcdefghijk");
  assert.equal(result[0].publisher, "유튜브");
  assert.deepEqual(validate([{ ...video, url: "https://www.youtube.com/@channel" }], ["https://www.youtube.com/@channel"]), []);
  assert.deepEqual(validate([{ ...video, url }]), []);
});
test("YouTube share, watch and shorts links deduplicate into one video", () => {
  const links = ["https://youtu.be/abcdefghijk?si=tracking", "https://www.youtube.com/watch?v=abcdefghijk&t=10", "https://m.youtube.com/shorts/abcdefghijk"];
  assert.equal(validate(links.map(url => ({ ...article, url, format: "video", access: "content" })), links).length, 1);
});
test("there are at most eight resources, without a minimum quota", () => {
  const links = Array.from({ length: 8 }, (_, index) => `${url}/${index}`);
  assert.equal(validate(links.map((url, index) => ({ ...article, url, title: `한국어 식사 기록 ${index}` })), links).length, 8);
  assert.equal(validate([article]).length, 1);
  assert.deepEqual(validate([]), []);
  assert.throws(() => validateNutritionArticles({ items: [] }, [], "고혈압"));
});

test("generic nutrition material is rejected unless it explicitly addresses the selected condition", () => {
  const generic = { ...article, title: "영양표시 읽는 방법", summary: "가공식품의 영양표시 항목을 확인하는 방법을 설명합니다." };
  assert.deepEqual(validate([generic], [url], "고혈압"), []);
  const specific = { ...generic, summary: "고혈압 식사에서 나트륨 표시를 확인하는 방법을 설명합니다." };
  assert.equal(validate([specific], [url], "고혈압").length, 1);
});

test("campaign and program overview pages are not treated as practical nutrition resources", () => {
  for (const title of ["영양의 날 캠페인 실시", "심뇌혈관질환 예방관리사업 개요", "저염식 교육 참가자 모집"]) {
    assert.deepEqual(validate([{ ...article, title, summary: "고혈압 식사와 영양 관리 내용을 안내합니다." }], [url], "고혈압"), []);
  }
});

test("Naver cafe article URL variants resolve to one public post", () => {
  const links = [
    "https://cafe.naver.com/ArticleRead.nhn?clubid=12345&articleid=67890",
    "https://m.cafe.naver.com/ca-fe/web/cafes/12345/articles/67890?fromList=true",
  ];
  const result = validate(links.map((url) => ({ ...article, url, title: "네이버 카페 식사 실천 기록" })), links);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.url, "https://cafe.naver.com/ca-fe/cafes/12345/articles/67890");
  assert.equal(result[0]?.platform, "naver");
});
test("unsafe links are rejected even when present in search metadata", () => {
  for (const value of ["javascript:alert(1)", "http://example.com/post", "https://127.0.0.1/post", "https://[::1]/post", "https://example.local/post", "https://user:password@example.com/post"]) {
    assert.equal(publicArticleUrl(value), null);
    assert.deepEqual(validate([{ ...article, url: value }], [value]), []);
  }
});
test("only a condition identifier enters the search route", () => {
  assert.equal(nutritionExplorationRequest.safeParse({ conditionId: "confirmed" }).success, true);
  assert.equal(nutritionExplorationRequest.safeParse({ conditionId: "confirmed", topicId: "shopping" }).success, false);
  assert.equal(nutritionExplorationRequest.safeParse({ conditionId: "confirmed", medicationIngredients: ["private"] }).success, false);
});

test("Naver mobile, desktop and PostView URLs refer to the same post", () => {
  const links = ["https://m.blog.naver.com/test_blog/123456", "https://blog.naver.com/test_blog/123456?trackingCode=test", "https://blog.naver.com/PostView.naver?blogId=test_blog&logNo=123456"];
  const result = validate(links.map(url => ({ ...article, url })), links);
  assert.equal(result.length, 1);
  assert.equal(result[0].url, "https://blog.naver.com/test_blog/123456");
  assert.equal(result[0].platform, "naver");
  for (const url of ["https://blog.naver.com/test_blog", "https://search.naver.com/search.naver?query=test"]) assert.equal(publicArticleUrl(url), null);
});

test("reposted titles do not inflate the list across different URLs", () => {
  const other = "https://other.example/repost";
  assert.equal(validate([article, { ...article, url: other, title: "한국어  식사 기록!" }], [url, other]).length, 1);
});

test("nutrition discovery keeps one request within a bounded search budget", () => {
  const plan = buildNutritionSearchPlan("합성 질환");
  assert.equal(plan.length, 4);
  assert.ok(plan.every((query) => query.includes("합성 질환")));
  assert.deepEqual(NUTRITION_SEARCH_BUDGET, {
    timeoutMs: 35_000,
    maxOutputTokens: 2_600,
    suggestedMaxToolCalls: 4,
    searchContextSize: "low",
  });
  assert.match(NUTRITION_SEARCH_INSTRUCTIONS, /최대 8개/);
  assert.match(NUTRITION_SEARCH_INSTRUCTIONS, /전체 4회 이내/);
  assert.match(NUTRITION_SEARCH_INSTRUCTIONS, /일반 질환 정보는 결과에 절대 포함하지 마세요/);
  assert.match(NUTRITION_SEARCH_INSTRUCTIONS, /식사나 영양이 본문의 핵심 주제/);
  assert.match(NUTRITION_SEARCH_INSTRUCTIONS, /일반 영양 자료를 conditionName에 임의로 응용/);
});
