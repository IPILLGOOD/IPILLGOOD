import { notFound } from "next/navigation";

export const metadata = { title: "샘플 UI 미리보기", robots: { index: false, follow: false } };
export default async function PreviewPage({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  const allowed = ["today", "dashboard", "medications", "nutrition", "check-in", "documents", "profile", "report"];
  if ((path[0] && !allowed.includes(path[0])) || path.length > 2 || (path.length === 2 && (path[0] !== "medications" || !/^sample-(?:[abcd]|search)$/.test(path[1])))) notFound();
  return null;
}
