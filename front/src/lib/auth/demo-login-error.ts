const FALLBACK_MESSAGE = "데모를 준비하지 못했어요. 잠시 후 다시 시도해주세요.";

export function getDemoLoginErrorMessage(error: string | undefined, reason?: string) {
  if (error === "demo_login_unavailable" && reason === "local_demo_mode_disabled") {
    return "로컬 데모가 꺼져 있어요. front/.env.local에 IPILLGOOD_DEMO_MODE=true를 추가하고 개발 서버를 다시 시작해주세요.";
  }
  return FALLBACK_MESSAGE;
}
