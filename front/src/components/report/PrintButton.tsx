"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button className="button button--secondary no-print" type="button" onClick={() => window.print()}>
      <Printer size={18} aria-hidden="true" />
      인쇄 또는 PDF 저장
    </button>
  );
}
