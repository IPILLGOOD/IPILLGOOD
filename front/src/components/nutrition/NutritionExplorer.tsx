"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, ChevronRight, Search } from "lucide-react";
import type { NutritionExploration } from "@care-atlas/backend/nutrition-exploration";

export function NutritionExplorer({
  conditions,
  loadArticles,
  sample = false,
}: {
  conditions: { id: string; standardName: string }[];
  sample?: boolean;
  loadArticles?: (conditionId: string) => Promise<NutritionExploration>;
}) {
  const [selectedId, setSelectedId] = useState(conditions[0]?.id ?? "");
  const [results, setResults] = useState<Record<string, NutritionExploration>>(
    {},
  );
  const [pending, setPending] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const requestPending = useRef(false);
  const [retryUntil, setRetryUntil] = useState(0);
  useEffect(() => {
    if (!retryUntil) return;
    const timer = setTimeout(
      () => setRetryUntil(0),
      Math.max(0, retryUntil - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [retryUntil]);
  const condition =
    conditions.find((item) => item.id === selectedId) ?? conditions[0];
  const conditionId = condition?.id ?? "";
  const result = results[conditionId];
  const articles = result?.articles ?? [];

  async function search() {
    if (requestPending.current || !conditionId || retryUntil > Date.now())
      return;
    requestPending.current = true;
    setPending(conditionId);
    setErrors((previous) => ({ ...previous, [conditionId]: "" }));
    try {
      if (loadArticles) {
        const data = await loadArticles(conditionId);
        setResults((previous) => ({ ...previous, [conditionId]: data }));
        return;
      }
      const response = await fetch("/api/nutrition/explore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conditionId }),
        signal: AbortSignal.timeout(43_000),
      });
      const data = await response.json();
      if (!response.ok) {
        const delay = Number(response.headers.get("Retry-After"));
        const seconds =
          response.status === 429 && Number.isFinite(delay) && delay > 0
            ? Math.min(3600, Math.ceil(delay))
            : 0;
        if (seconds) setRetryUntil(Date.now() + seconds * 1000);
        throw new Error(
          (data.message || "검색에 실패했어요.") +
            (seconds ? ` ${seconds}초 후 다시 시도해주세요.` : ""),
        );
      }
      if (
        !Array.isArray(data.articles) ||
        typeof data.retrievedAt !== "string"
      ) {
        throw new Error("검색 결과를 확인하지 못했어요.");
      }
      setResults((previous) => ({ ...previous, [conditionId]: data }));
    } catch (error) {
      const message =
        error instanceof Error && error.name !== "TimeoutError"
          ? error.message
          : "검색이 지연되고 있어요. 잠시 후 다시 시도해주세요.";
      setErrors((previous) => ({ ...previous, [conditionId]: message }));
    } finally {
      requestPending.current = false;
      setPending(null);
    }
  }

  if (!condition) return null;
  return (
    <section className="nutrition-explorer" aria-label="식사 자료 탐색">
      <div className="nutrition-explorer__search-panel">
        <div className="nutrition-explorer__intro">
          <h2>어떤 질환을 위한 영양 정보가 궁금하세요?</h2>
          <p>프로필에 등록된 질환만 선택 가능해요.</p>
        </div>
        <div className="nutrition-explorer__controls">
          <label>
            알아볼 질환
            <select
              value={conditionId}
              onChange={(event) => {
                setSelectedId(event.target.value);
              }}
            >
              {conditions.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.standardName}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button button--primary"
            type="button"
            disabled={pending !== null || retryUntil > 0}
            onClick={search}
          >
            <Search size={17} aria-hidden="true" />
            {pending === conditionId
              ? "고르고 있어요…"
              : retryUntil
                ? "잠시 후 다시 시도"
                : result
                  ? "자료 다시 확인"
                  : "관련 자료 찾기"}
          </button>
        </div>
      </div>
      <div role="status" aria-live="polite" className="nutrition-search-status">
        {pending !== null ? (
          <p>
            {pending === conditionId
              ? "관련 자료를 빠르게 모으고 있어요."
              : "앞서 선택한 질환의 자료를 찾고 있어요. 잠시 기다려주세요."}
          </p>
        ) : null}
        {errors[conditionId] ? (
          <p>
            {errors[conditionId]}{" "}
            {result?.articles.length
              ? "이전에 찾은 자료는 아래에 남겨뒀어요."
              : ""}
          </p>
        ) : null}
      </div>
      {result?.articles.length ? (
        <div className="nutrition-resource-list">
          <div className="nutrition-results-heading">
            <div>
              <h2>살펴볼 자료</h2>
              <p>
                {condition.standardName}과 관련성 있고 읽기 쉬운 자료를
                정리했어요.
              </p>
            </div>
            <span>{articles.length}개</span>
          </div>
          <div className="nutrition-resource-grid">
            {articles.map((article) => (
              <article className="nutrition-resource" key={article.url}>
                <div className="nutrition-resource__content">
                  <h2>
                    <a
                      href={article.url}
                      target={sample ? undefined : "_blank"}
                      rel="noopener noreferrer"
                    >
                      {article.title}
                    </a>
                  </h2>
                  <p>{article.summary}</p>
                  <small>{article.publisher}</small>
                </div>
                <a
                  className="nutrition-resource__open"
                  href={sample ? "#sample-note" : article.url}
                  target={sample ? undefined : "_blank"}
                  rel="noopener noreferrer"
                >
                  <span className="sr-only">
                    {sample ? "샘플 자료 안내" : `${article.title} 열기`}
                  </span>
                  <ChevronRight size={22} aria-hidden="true" />
                </a>
              </article>
            ))}
          </div>
        </div>
      ) : !pending && !errors[conditionId] ? (
        <div className="nutrition-resource-empty">
          <BookOpen size={28} aria-hidden="true" />
          <strong>
            {result ? "찾은 자료가 없어요" : "궁금한 질환을 고르고 시작하세요"}
          </strong>
          <p>
            {result
              ? "지금은 충분히 유익한 한국어 자료를 찾지 못했어요."
              : "구체적인 자료를 골라 보여드려요."}
          </p>
        </div>
      ) : null}
      {result?.articles.length ? (
        <p className="nutrition-search-note" id="sample-note">
          {sample
            ? "가상의 UI 샘플입니다. 실제 검색이나 AI 분석을 실행하지 않았으며, 원문과 영상은 제공하지 않아요."
            : "AI가 고른 참고 자료예요. 개인 경험은 치료 효과를 보장하지 않아요."}
          <span>
            {sample ? "샘플 생성" : "검색"}{" "}
            {new Date(result.retrievedAt).toLocaleDateString("ko-KR", {
              timeZone: "Asia/Seoul",
            })}{" "}
            {sample ? "" : "· 하루 동안 같은 결과를 보여드려요."}
          </span>
        </p>
      ) : null}
    </section>
  );
}
