import { PILL_OBSERVATION_SCHEMA_VERSION, type ObservedPillSide, type PillObservation } from "../src/pill-identification.ts";

// Synthetic feature records, not real products or a photo-accuracy evaluation set.
export function pillRecord(overrides: Record<string, unknown> = {}) {
  return {
    ITEM_SEQ: "209900001", ITEM_NAME: "테스트 전용 정제 A", ENTP_NAME: "가상 제조사",
    FORM_CODE_NAME: "필름코팅정", DRUG_SHAPE: "원형", COLOR_CLASS1: "하양", COLOR_CLASS2: "",
    PRINT_FRONT: "TEST", PRINT_BACK: "10", LINE_FRONT: "-", LINE_BACK: "+",
    ITEM_IMAGE: "https://nedrug.mfds.go.kr/pbp/cmn/itemImageDownload/test-fixture",
    IMG_REGIST_TS: "20260101", CHANGE_DATE: "20260801",
    ...overrides,
  };
}

export function pillObservation(overrides: Partial<PillObservation> = {}): PillObservation {
  return {
    schemaVersion: PILL_OBSERVATION_SCHEMA_VERSION, source: "manual", form: "tablet", integrity: "intact", count: 1,
    overlapping: false, quality: "clear", shape: "원형", colors: ["하양"],
    front: observedSide("TEST", "single"),
    back: observedSide("10", "cross"),
    ...overrides,
  };
}

export function observedSide(imprint: string | null, scoreLine: ObservedPillSide["scoreLine"]): ObservedPillSide {
  if (imprint === null) return { imprintCandidates: [], noImprintObserved: false, imprintVisibility: "unreadable", scoreLine };
  if (imprint === "") return { imprintCandidates: [], noImprintObserved: true, imprintVisibility: "clear", scoreLine };
  return { imprintCandidates: [imprint], noImprintObserved: false, imprintVisibility: "clear", scoreLine };
}

export function pillEnvelope(items: unknown[], overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
    body: { items, pageNo: 1, numOfRows: 100, totalCount: items.length, ...overrides },
  });
}
