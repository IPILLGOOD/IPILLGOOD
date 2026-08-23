import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "IPILLGOOD - 매일 이어지는 안심 돌봄",
    short_name: "IPILLGOOD",
    description: "복약과 몸 상태 기록을 오늘의 쉬운 돌봄 행동으로 연결합니다.",
    start_url: "/today",
    scope: "/",
    display: "standalone",
    background_color: "#F6F8F4",
    theme_color: "#176B4D",
    lang: "ko-KR",
    categories: ["health", "medical", "lifestyle"],
    icons: [
      {
        src: "/icons/pwa-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/pwa-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/pwa-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
