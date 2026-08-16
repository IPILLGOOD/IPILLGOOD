import { Cloud, CloudOff } from "lucide-react";

export function ConnectionStatus({ source }: { source: "firestore" | "local-fallback" }) {
  const connected = source === "firestore";
  const Icon = connected ? Cloud : CloudOff;
  return (
    <span className={connected ? "connection connection--on" : "connection connection--off"}>
      <Icon size={15} aria-hidden="true" />
      {connected ? "안전하게 저장 중" : "데모 데이터로 보기"}
    </span>
  );
}
