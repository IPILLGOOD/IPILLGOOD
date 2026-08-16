export interface MedicationAnalyzerResult {
  status: "not_configured" | "complete";
  message: string;
}

/**
 * AI 제공자와 무관한 문서 분석 경계입니다.
 * OPENAI_API_KEY가 추가되면 이 함수 내부만 실제 구현으로 교체합니다.
 */
export async function analyzeMedicationDocument(): Promise<MedicationAnalyzerResult> {
  if (!process.env.OPENAI_API_KEY) {
    return {
      status: "not_configured",
      message: "AI 분석 키가 아직 연결되지 않았어요. 문서 정보만 안전하게 등록했습니다.",
    };
  }

  return {
    status: "not_configured",
    message: "AI 어댑터가 준비돼 있어요. 제공자 호출 구현을 연결해주세요.",
  };
}
