"use client";

export function QuestionRecovery({ unavailable, pending, message, onRetry }: {
  unavailable: boolean; pending: boolean; message: string; onRetry: () => void;
}) {
  return (
    <section className="question-block" aria-label="맞춤 질문 복구">
      <p role="status">{message || (unavailable
        ? "질문을 준비하지 못해 아직 기록을 제출할 수 없어요. 잠시 후 다시 시도해 주세요."
        : "입력한 내용은 이 화면에 유지돼요. 새로고침하지 않고 질문을 다시 준비할 수 있어요.")}</p>
      <button className="button button--secondary" type="button" disabled={pending} onClick={onRetry}>
        {pending ? "질문 준비 중…" : "질문 다시 준비하기"}
      </button>
    </section>
  );
}
