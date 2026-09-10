import { PreviewWorkspace } from "@/components/preview/PreviewWorkspace";

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return <>{children}<PreviewWorkspace /></>;
}
