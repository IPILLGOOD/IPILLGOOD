import type { Metadata } from "next";

import { NotFoundPage } from "@/components/not-found/NotFoundPage";

export const metadata: Metadata = {
  title: "페이지를 찾을 수 없어요",
  robots: { index: false },
};

// Next assigns /404 its HTTP 404 status. Render normally so the initial HTML
// includes the recovery UI, including when JavaScript is unavailable.
export default function Page() {
  return <NotFoundPage />;
}
