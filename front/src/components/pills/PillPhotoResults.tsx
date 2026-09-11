import type { PillWebResult, PillCandidate } from "@care-atlas/backend/pill-photo-web";
import styles from "./PillPhoto.module.css";

function Candidate({ candidate }: { candidate: PillCandidate }) {
  return <li className={styles.candidate}>
    <h3>{candidate.variants[0]?.item.productName}</h3>
    {candidate.variants.map((variant, index) => <div key={index} className={styles.variant}>
      <p>{variant.item.manufacturer ?? "제조사 정보 없음"} · 품목코드 {candidate.itemSeq}</p>
      <p>공식 각인: 앞면 {variant.item.front.rawImprint ?? "정보 없음"} / 뒷면 {variant.item.back.rawImprint ?? "정보 없음"}</p>
      <p>{candidate.grade === "strong" ? "관찰 특징 일치" : "일부 특징 일치 · 추가 확인 필요"}</p>
      {variant.conflicts.length > 0 && <p className={styles.caution}>사진과 공식 정보에서 다른 특징이 있어요. 약 봉투·약사 안내와 함께 확인해주세요.</p>}
      {variant.reviewReasons.length > 0 && <p className={styles.caution}>공식 각인 또는 제형 근거가 부족해 후보로 확정할 수 없어요.</p>}
      {variant.item.imageUrl && <a className={styles.external} href={variant.item.imageUrl} target="_blank" rel="noopener noreferrer">공식 이미지 보기 (새 창)</a>}
    </div>)}
  </li>;
}
export function PillPhotoResults({ result }: { result: PillWebResult }) {
  const { comparison } = result;
  const search = comparison.search;
  const retake = comparison.status === "needs_retake" || search?.status === "needs_retake";
  return <section className={styles.results} aria-labelledby="pill-photo-results">
    <h2 id="pill-photo-results">{retake ? "앞뒤 사진을 다시 확인해주세요" : "사진 비교 결과"}</h2>
    <p>{retake ? "같은 알약 한 개의 앞면과 뒷면을 밝은 곳에서 촬영해주세요. 각인이 선명하고 알약 전체가 보여야 해요." : search?.message ?? "사진의 특징을 확인하지 못했어요."}</p>
    {comparison.observation && <details><summary>사진에서 읽은 각인 확인</summary>
      <p>앞면: {comparison.observation.front?.imprintCandidates.join(" / ") || "읽힌 글자 없음"}</p>
      <p>뒷면: {comparison.observation.back?.imprintCandidates.join(" / ") || "읽힌 글자 없음"}</p>
      <p>사진에서 읽은 내용에도 오류가 있을 수 있어요.</p>
    </details>}
    {!retake && search && <>
      <p className={styles.caution}>{search.notice}</p>
      {search.candidates.length > 0 && <><p>비교 후보 {search.metrics.candidateCount}개{search.truncated ? ` 중 ${search.candidates.length}개 표시` : ""}</p>
        <ul className={styles.list}>{search.candidates.map(candidate => <Candidate key={candidate.itemSeq} candidate={candidate} />)}</ul></>}
      {search.heldCandidates.length > 0 && <details><summary>판단을 보류한 비교 항목 {search.metrics.heldCandidateCount}개</summary>
        <p>각인·제형 정보가 부족한 항목이에요. 약을 찾았다는 뜻이 아닙니다.</p>
        <ul className={styles.list}>{search.heldCandidates.map(candidate => <Candidate key={candidate.itemSeq} candidate={candidate} />)}</ul>
        {search.heldTruncated && <p>전체 중 {search.heldCandidates.length}개만 표시했어요.</p>}
      </details>}
    </>}
    <p className={styles.meta}><a href="https://www.data.go.kr/data/15057639/openapi.do" target="_blank" rel="noopener noreferrer">식약처 의약품 낱알식별 정보 (새 창)</a><br />목록 확인일 {new Date(result.catalog.verifiedAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })} · {result.catalog.totalCount.toLocaleString("ko-KR")}개 공식 기록</p>
  </section>;
}
