"use client";

import Link from "next/link";
import { useState } from "react";

export default function PreviewDevicePage() {
  const [width, setWidth] = useState(390);
  return <main className="preview-device"><header><Link href="/preview">← 전체 화면으로 돌아가기</Link><label>화면 너비 <select value={width} onChange={(e) => setWidth(Number(e.target.value))}><option value={390}>모바일 · 390px</option><option value={768}>태블릿 · 768px</option><option value={1440}>데스크톱 · 1440px</option></select></label></header><div className="preview-device__stage"><iframe title="기기별 샘플 UI" src="/preview" style={{ width }} /></div></main>;
}
