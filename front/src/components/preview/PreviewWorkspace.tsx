"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Check,
  FileText,
  HeartPulse,
  RotateCcw,
} from "lucide-react";
import type { ActionState, ConfirmedCondition } from "@care-atlas/backend";
import type { NutritionExploration } from "@care-atlas/backend/nutrition-exploration";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { FormMessage } from "@/components/ui/FormMessage";
import { MedicationCabinet } from "@/components/medications/MedicationCabinet";
import { CareDiaryCalendar } from "@/components/dashboard/CareDiaryCalendar";
import { TodayTaskList } from "@/components/today/TodayTaskList";
import { NutritionExplorer } from "@/components/nutrition/NutritionExplorer";
import { DocumentAnalysisResult } from "@/components/documents/DocumentAnalysisResult";
import { ConfirmedConditionsEditor } from "@/components/profile/ConfirmedConditionsEditor";
import { PreviewMedicationSearch } from "./PreviewMedicationSearch";
import { parseMedicationRegistrationSelection } from "@/lib/medication-registration-options";
import {
  makePreviewDoses,
  previewMedications,
  previewConditions,
  previewAnalysis,
} from "./preview-data";

const pages = [
  ["today", "오늘 할 일"],
  ["dashboard", "대시보드"],
  ["medications", "복용약"],
  ["nutrition", "식사/영양"],
  ["check-in", "안부 확인"],
  ["documents", "문서"],
  ["profile", "프로필"],
  ["report", "상담용 기록"],
];
type Scenario = "filled" | "empty" | "loading" | "error";
const idle: ActionState = { status: "idle", message: "" };
const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 650));

export function PreviewWorkspace() {
  const pathname = usePathname();
  const [, , selected = "today", medicationId] = pathname.split("/");
  const page = selected || "today";
  const [day] = useState(() =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  );
  const [scenario, setScenario] = useState<Scenario>("filled");
  const [medications, setMedications] = useState(previewMedications);
  const [doses, setDoses] = useState(() => makePreviewDoses(day));
  const [conditions, setConditions] = useState(previewConditions);
  const [name, setName] = useState("김샘플");
  const [revision, setRevision] = useState(1);
  const [notice, setNotice] = useState<ActionState>(idle);
  const [documents, setDocuments] = useState([
    "샘플_처방전.pdf",
    "샘플_진단서.jpg",
    "샘플_복약안내서.pdf",
  ]);
  const [documentStep, setDocumentStep] = useState<
    "idle" | "processing" | "review" | "saved"
  >("idle");
  const [documentType, setDocumentType] = useState("처방전");
  const [connection, setConnection] = useState<"none" | "code" | "connected">(
    "none",
  );
  const [checkIn, setCheckIn] = useState(false);
  const [notification, setNotification] = useState(false);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const [resetOpen, setResetOpen] = useState(false);
  const empty = scenario === "empty";
  const shownMeds = empty ? [] : medications;
  const selectedMedication = medicationId ? shownMeds.find((medication) => medication.id === medicationId) : undefined;
  const calendarMeds = shownMeds.map((m) => ({
    ...m,
    startDate: "2026-01-01",
  }));
  const todayDoses = doses.filter((d) => d.scheduledAt.startsWith(day));
  const todayTasks = todayDoses.flatMap((dose, slotIndex) => {
    const medication = medications.find((item) => item.id === dose.medicationPlanId);
    if (!medication) return [];
    const timeLabel = /T(\d{2}:\d{2})/.exec(dose.scheduledAt)?.[1] ?? "시간 확인";
    return [{
      id: dose.id,
      medicationPlanId: medication.id,
      productName: medication.productName,
      doseAmount: medication.dose,
      frequency: medication.frequency,
      timing: medication.timing,
      slotIndex,
      slotLabel: medication.timing,
      timeLabel,
      scheduledAt: dose.scheduledAt,
      response: dose.response,
      hasRecordedResponse: dose.response !== "not_yet",
    }];
  });
  function message(text: string) {
    setNotice({ status: "success", message: text });
  }
  function reset() {
    generation.current += 1;
    setBusy(false);
    setMedications(previewMedications);
    setDoses(makePreviewDoses(day));
    setConditions(previewConditions);
    setName("김샘플");
    setDocuments(["샘플_처방전.pdf", "샘플_진단서.jpg", "샘플_복약안내서.pdf"]);
    setDocumentStep("idle");
    setConnection("none");
    setCheckIn(false);
    setNotification(false);
    setScenario("filled");
    setRevision((v) => v + 1);
    setResetOpen(false);
    message("처음 샘플로 되돌렸어요.");
  }
  async function loadArticles(): Promise<NutritionExploration> {
    await delay();
    return {
      retrievedAt: new Date().toISOString(),
      articles: [
        {
          title: "한 끼 식사를 준비하는 방법 · 샘플",
          publisher: "가상 블로그",
          platform: "naver",
          verification: "preview",
          format: "blog",
          topic: "식단·레시피",
          summary:
            "자료 제목, 요약과 출처가 표시되는 모습을 확인하는 가상 콘텐츠예요.",
          url: "/preview/nutrition#sample-blog",
        },
        {
          title: "식사에 관해 전문가에게 물어볼 것 · 샘플",
          publisher: "가상 영상 채널",
          platform: "youtube",
          verification: "content",
          format: "video",
          topic: "전문가 설명",
          summary:
            "영상 결과의 표시를 확인하기 위한 샘플이에요. 실제 영상이나 의학적 안내가 아닙니다.",
          url: "/preview/nutrition#sample-video",
        },
        {
          title: "장을 보기 전에 확인할 목록 · 샘플",
          publisher: "가상 자료실",
          platform: "other",
          verification: "content",
          format: "article",
          topic: "장보기·외식",
          summary:
            "출처 필터와 긴 요약문이 좁은 화면에서도 잘 읽히는지 확인해보세요.",
          url: "/preview/nutrition#sample-article",
        },
      ],
    };
  }
  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const draft = JSON.parse(
      String(data.get("confirmedConditions")),
    ) as (ConfirmedCondition & { confirmed: boolean })[];
    if (
      draft.some((item) => !item.confirmed || !item.standardName.trim()) ||
      new Set(draft.map((item) => item.standardName.trim())).size !==
        draft.length
    ) {
      setNotice({
        status: "error",
        message: "질환명을 중복 없이 입력하고 확인란을 선택해주세요.",
      });
      return;
    }
    setName(String(data.get("displayName")).trim() || "김샘플");
    setConditions(
      draft.map((item, index) => ({
        ...item,
        standardName: item.standardName.trim(),
        id: item.id || `sample-condition-${revision}-${index}`,
        sourceLabel: "가상 프로필에서 확인",
        confirmedAt: new Date().toISOString(),
      })),
    );
    setScenario("filled");
    setRevision((v) => v + 1);
    message("샘플 프로필을 저장했어요. 식사/영양의 질환 목록에도 반영돼요.");
  }
  async function analyzeDocument() {
    const started = generation.current;
    setDocumentStep("processing");
    await delay();
    if (started === generation.current) setDocumentStep("review");
  }
  function registerDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (documentType !== "진단서") {
      setDoses((items) => [...items.filter((d) => d.id !== "sample-dose-new"), { id: "sample-dose-new", medicationPlanId: "sample-d", scheduledAt: `${day}T08:00:00+09:00`, response: "not_yet", answeredBy: "caregiver" }]);
      setMedications((items) => [
        ...items.filter((m) => m.id !== "sample-d"),
        {
          ...previewMedications[1],
          id: "sample-d",
          productName: String(data.get("productName")),
          dose: String(data.get("dose")),
          timing: String(data.get("timing")),
          sourceLabel: "새 가상 처방전에서 등록",
        },
      ]);
    }
    if (documentType === "진단서")
      setConditions((items) => [
        ...items.filter((c) => c.id !== "sample-diagnosis"),
        {
          id: "sample-diagnosis",
          standardName: String(data.get("condition")),
          code: "",
          sourceLabel: "가상 진단서에서 확인",
          confirmedAt: new Date().toISOString(),
        },
      ]);
    setDocuments((items) => [
      `새_샘플_${documentType}_${items.length + 1}.pdf`,
      ...items,
    ]);
    setScenario("filled");
    setDocumentStep("saved");
    message(
      "샘플 문서를 등록했어요. 복용약 또는 프로필에서 결과를 확인해보세요.",
    );
  }
  return (
    <>
      <div className="app-shell experience-shell preview-shell">
        <aside className="sidebar">
          <Link className="brand" href="/preview">
            <HeartPulse size={24} />
            <span>
              <strong>IPILLGOOD</strong>
              <small>매일 이어지는 안심 돌봄</small>
            </span>
          </Link>
          <p className="sidebar-section-label">샘플 돌봄 공간</p>
          <nav className="side-nav" aria-label="미리보기 메뉴">
            {pages.map(([key, label], index) => (
              <Link
                key={key}
                href={`/preview/${key}`}
                className={`nav-link ${page === key ? "nav-link--active" : ""}`}
                aria-current={page === key ? "page" : undefined}
                onClick={() => setNotice(idle)}
              >
                <span className="preview-nav-index">0{index + 1}</span>
                {label}
              </Link>
            ))}
          </nav>
          <Link className="sidebar-guide" href="/">
            서비스 홈 <ArrowRight size={16} />
          </Link>
        </aside>
        <div className="app-column">
          <div className="preview-toolbar">
            <div>
              <strong>UI 미리보기</strong>
              <span>가상 데이터 · 새로고침하면 초기화돼요</span>
            </div>
            <label>
              화면 상태{" "}
              <select
                aria-label="화면 상태"
                value={scenario}
                onChange={(e) => {
                  setScenario(e.target.value as Scenario);
                  setNotice(idle);
                }}
              >
                {[
                  ["filled", "데이터 있음"],
                  ["empty", "데이터 없음"],
                  ["loading", "불러오는 중"],
                  ["error", "오류 / 재시도"],
                ].map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <Link
              className="button button--quiet preview-device-link"
              href="/preview-device" target="_top"
            >
              기기별 보기
            </Link>
            <button className="button button--quiet" onClick={reset}>
              <RotateCcw size={15} />
              샘플 초기화
            </button>
          </div>
          <nav
            className="preview-mobile-menu"
            aria-label="미리보기 모바일 메뉴"
          >
            {pages.map(([key, label]) => (
              <Link
                key={key}
                href={`/preview/${key}`}
                aria-current={page === key ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
          <main className="main-content" id="main-content">
            <FormMessage state={notice} />
            <div key={`${page}-${scenario}`} className="preview-page">
              <PageHeader
                eyebrow={pages.find(([key]) => key === page)?.[1]}
                title={
                  page === "today"
                    ? `${name}님의 오늘을 함께 살펴봐요`
                    : page === "dashboard"
                      ? `${name}님의 돌봄 다이어리`
                      : page === "medications"
                        ? "복용약을 차근차근 알아봐요"
                        : page === "nutrition"
                          ? "오늘의 식사, 조금 더 알아보기"
                          : page === "documents"
                            ? "문서 한 장에서 시작하는 돌봄"
                            : page === "profile"
                              ? "돌봄에 필요한 정보를 모아요"
                              : page === "report"
                                ? "진료 전에, 기록을 한눈에"
                                : "오늘 몸 상태는 어떠세요?"
                }
                description="이 공간의 이름·약·문서·검색 결과는 모두 UI 확인용 샘플입니다."
              />
              {scenario === "loading" ? (
                <div
                  className="preview-skeleton"
                  role="status"
                  aria-label="불러오는 중"
                >
                  <p>샘플 화면을 불러오고 있어요…</p>
                  <span />
                  <span />
                  <span />
                  <button
                    className="button button--secondary"
                    onClick={() => setScenario("filled")}
                  >
                    완료 상태 보기
                  </button>
                </div>
              ) : scenario === "error" ? (
                <Card>
                  <FormMessage
                    state={{
                      status: "error",
                      message:
                        "일시적으로 정보를 불러오지 못했어요. 오류 화면을 확인하는 샘플입니다.",
                    }}
                  />
                  <button
                    className="button button--primary"
                    onClick={() => setScenario("filled")}
                  >
                    다시 시도
                  </button>
                </Card>
              ) : (
                <>
                  {page === "today" && (
                    <>
                      <Card>
                        <div className="section-heading">
                          <h2>오늘 복용할 것</h2>
                          <span>{day}</span>
                        </div>
                        {empty ? (
                          <Empty
                            text="아직 복약 일정이 없어요"
                            href="documents"
                          />
                        ) : (
                          <TodayTaskList tasks={todayTasks} />
                        )}
                      </Card>
                      <Card className="preview-section">
                        <h2>복약 알림</h2>
                        <p>
                          {notification
                            ? "샘플 알림 설정이 켜졌어요."
                            : "알림 설정 전 상태를 확인해보세요."}
                        </p>
                        <button
                          className="button button--secondary"
                          onClick={() => {
                            setNotification(!notification);
                            message(
                              "샘플 설정을 바꿨어요. 실제 알림은 발송하지 않아요.",
                            );
                          }}
                        >
                          {notification ? "샘플 알림 끄기" : "샘플 알림 켜기"}
                        </button>
                      </Card>
                    </>
                  )}
                  {page === "dashboard" && (
                    <>
                      <CareDiaryCalendar
                        initialDate={day}
                        medications={calendarMeds}
                        doses={empty ? [] : doses}
                        symptoms={
                          empty
                            ? []
                            : [
                                {
                                  id: "sample-symptom",
                                  symptomType: "어지러움",
                                  occurredAt: `${day}T09:00:00+09:00`,
                                  severity: 2,
                                },
                              ]
                        }
                        revision={revision}
                      />

                    </>
                  )}
                  {page === "medications" && !medicationId ? <PreviewMedicationSearch today={day} revision={revision} onAdd={async (_state, data) => {
                    if (medications.some((m) => m.id === "sample-search")) return { status: "error", message: "이미 추가한 샘플 약이에요." };
                    const end = String(data.get("endDate") ?? ""); const start = String(data.get("startDate"));
                    if (end && end < start) return { status: "error", message: "종료일은 시작일 이후로 입력해주세요." };
                    const selection = parseMedicationRegistrationSelection({
                      doseQuantity: String(data.get("doseQuantity") ?? ""),
                      doseUnit: String(data.get("doseUnit") ?? ""),
                      frequency: String(data.get("frequency") ?? ""),
                      timings: data.getAll("timing").map(String),
                    });
                    if (!selection) return { status: "error", message: "복용량·주기·시점을 다시 선택해주세요." };
                    setMedications((items) => [...items, { ...previewMedications[0], id: "sample-search", productName: "샘플 검색약", dose: selection.doseAmount, frequency: selection.frequency, timing: selection.timing, sourceLabel: "UI 미리보기 가상 검색 결과" }]);
                    const scheduledDoses = selection.frequency === "필요할 때" ? [] : selection.timing.split("·").flatMap((timing, index) => {
                      const match = timing.match(/(\d{2}):(\d{2})/);
                      if (!match) return [];
                      return [{ id: `sample-search-dose-${index}`, medicationPlanId: "sample-search", scheduledAt: `${start}T${match[1]}:${match[2]}:00+09:00`, response: "not_yet" as const, answeredBy: "caregiver" as const }];
                    });
                    setDoses((items) => [...items, ...scheduledDoses]);
                    setScenario("filled"); setRevision((v) => v + 1);
                    return { status: "success", message: "샘플 검색약을 추가했어요." };
                  }} /> : null}
                  {page === "medications" &&
                    (empty ? (
                      <Empty
                        text="아직 등록된 복용약이 없어요"
                        href="documents"
                      />
                    ) : medicationId ? (
                      <>
                        <Link href="/preview/medications">← 복용약 목록</Link>
                        {selectedMedication ? (
                          <div className="medication-detail-page">
                            <div className="medication-detail-page__main">
                              <PageHeader eyebrow="약 상세 정보" title={selectedMedication.productName} description={`성분명 · ${selectedMedication.ingredientName}`} />
                              <Card tone="accent">
                                <div className="detail-section-heading"><div><h2>이 약을 쉽게 설명하면</h2><p>{selectedMedication.purpose}</p></div></div>
                              </Card>
                              <Card>
                                <div className="section-heading"><div><h2>먹는 방법과 오늘 일정</h2><p>보호자가 확인한 복용 계획이에요.</p></div></div>
                                <dl className="medication-facts medication-facts--detail">
                                  <div><dt>한 번에</dt><dd>{selectedMedication.dose}</dd></div>
                                  <div><dt>복용 주기</dt><dd>{selectedMedication.frequency}</dd></div>
                                  <div><dt>먹는 시점</dt><dd>{selectedMedication.timing}</dd></div>
                                </dl>
                              </Card>
                              <Card>
                                <div className="detail-section-heading"><div><h2>흔히 느낄 수 있는 변화</h2><p>식약처 이상반응 정보를 LLM이 쉬운 말로 정리한 가상 예시예요. 모든 사람에게 나타나는 것은 아니에요.</p></div></div>
                                <ul className="watch-list">{(selectedMedication.commonEffects ?? []).map((effect) => <li key={effect}>{effect}</li>)}</ul>
                              </Card>
                            </div>
                          </div>
                        ) : <Empty text="약 정보를 찾지 못했어요" href="medications" />}
                      </>
                    ) : (
                      <MedicationCabinet
                        medications={shownMeds}
                        detailBase="/preview/medications"
                      />
                    ))}
                  {page === "nutrition" &&
                    (empty || !conditions.length ? (
                      <Empty
                        text="먼저 확정 질환을 등록해주세요"
                        href="profile"
                      />
                    ) : (
                      <NutritionExplorer
                        key={conditions
                          .map((c) => c.id + c.standardName)
                          .join()}
                        conditions={conditions}
                        loadArticles={loadArticles}
                        sample
                      />
                    ))}
                  {page === "documents" && (
                    <>
                      <ol className="document-journey">
                        {["문서 선택", "내용 확인", "등록 완료"].map((s, i) => (
                          <li key={s}>
                            <span>0{i + 1}</span>
                            <strong>{s}</strong>
                          </li>
                        ))}
                      </ol>
                      <div className="document-layout">
                        <Card>
                          <h2>샘플 문서 등록</h2>
                          <p>파일 없이 등록 과정을 확인해보세요.</p>
                          <label className="field">
                            문서 종류
                            <select
                              value={documentType}
                              disabled={documentStep === "processing"}
                              onChange={(e) => {
                                setDocumentType(e.target.value);
                                setDocumentStep("idle");
                              }}
                            >
                              {["처방전", "약봉투", "진단서", "복약안내서"].map((t) => (
                                <option key={t}>{t}</option>
                              ))}
                            </select>
                          </label>
                          <div className="upload-dropzone">
                            <FileText size={32} />
                            <strong>
                              가상 {documentType} · 바로 확인해보세요
                            </strong>
                            <button
                              className="button button--primary"
                              disabled={documentStep === "processing"}
                              onClick={analyzeDocument}
                            >
                              {documentStep === "processing"
                                ? "샘플 분석 중…"
                                : "샘플 문서 분석하기"}
                            </button>
                          </div>
                          {documentStep === "review" && (
                            <>
                              <DocumentAnalysisResult
                                analysis={{
                                  ...previewAnalysis,
                                  ...(documentType === "진단서" ? {
                                    summary: "UI 확인용 가상 진단서에서 질환 1개를 찾았어요.",
                                    findings: [{ label: "문서", value: "가상 진단서" }, { label: "확인할 질환", value: "골관절염" }],
                                    carePoints: ["질환명을 확인하고 샘플 프로필에 등록해보세요."],
                                  } : {}),
                                  documentType:
                                    documentType as typeof previewAnalysis.documentType,
                                }}
                              />
                              <form
                                onSubmit={registerDocument}
                                className="preview-section"
                              >
                                <h3>등록 전 내용 확인</h3>
                                {documentType === "진단서" ? (
                                  <label className="field">
                                    질환명
                                    <input
                                      name="condition"
                                      defaultValue="골관절염"
                                      required
                                    />
                                  </label>
                                ) : (
                                  <>
                                    <label className="field">
                                      약 이름
                                      <input
                                        name="productName"
                                        defaultValue="샘플 복용약 D"
                                        required
                                      />
                                    </label>
                                    <label className="field">
                                      1회 복용량
                                      <input
                                        name="dose"
                                        defaultValue="1정"
                                        required
                                      />
                                    </label>
                                    <label className="field">
                                      복용 시점
                                      <input
                                        name="timing"
                                        defaultValue="아침 식사 후"
                                        required
                                      />
                                    </label>
                                  </>
                                )}
                                <label className="preview-consent">
                                  <input type="checkbox" required /> 샘플 내용을
                                  확인했어요
                                </label>
                                <button className="button button--primary">
                                  샘플 등록 완료
                                </button>
                              </form>
                            </>
                          )}
                          {documentStep === "saved" && (
                            <div className="completion-panel" role="status">
                              <Check />
                              <h3>샘플 등록을 마쳤어요</h3>
                              <Link
                                href={`/preview/${documentType === "진단서" ? "profile" : "medications"}`}
                              >
                                등록 결과 보기 →
                              </Link>
                            </div>
                          )}
                        </Card>
                        <Card>
                          <h2>등록한 문서</h2>
                          {empty ? (
                            <p>등록된 문서가 없어요.</p>
                          ) : (
                            documents.map((doc) => (
                              <div className="preview-document-row" key={doc}>
                                <FileText size={20} />
                                <details>
                                  <summary>{doc}</summary>
                                  <p>가상 문서 · 내용 확인 완료</p>
                                  <p>
                                    실제 개인 정보나 파일이 포함되지 않은 UI
                                    샘플입니다.
                                  </p>
                                </details>
                                <button
                                  className="button button--quiet"
                                  aria-label={`${doc} 삭제`}
                                  onClick={() => {
                                    setDocuments(
                                      documents.filter((item) => item !== doc),
                                    );
                                    message("샘플 문서를 삭제했어요.");
                                  }}
                                >
                                  삭제
                                </button>
                              </div>
                            ))
                          )}
                        </Card>
                      </div>
                    </>
                  )}
                  {page === "profile" && (
                    <div className="profile-layout">
                      <Card>
                        <form onSubmit={saveProfile}>
                          <h2>기본 정보</h2>
                          <label className="field">
                            이름
                            <input
                              name="displayName"
                              defaultValue={empty ? "" : name}
                              required
                              maxLength={40}
                            />
                          </label>
                          <ConfirmedConditionsEditor
                            key={`${revision}-${empty}`}
                            conditions={empty ? [] : conditions}
                          />
                          <button className="button button--primary">
                            샘플 프로필 저장
                          </button>
                        </form>
                      </Card>
                      <aside>
                        <Card className="connection-card">
                          <p className="eyebrow">함께하는 돌봄</p>
                          <h2>돌봄 화면 연결</h2>
                          <p>같은 기록을 함께 보는 연결 과정을 확인해보세요.</p>
                          {connection === "none" ? (
                            <button
                              className="button button--primary"
                              onClick={() => setConnection("code")}
                            >
                              샘플 연결 코드 만들기
                            </button>
                          ) : connection === "code" ? (
                            <>
                              <p className="preview-code">DEMO 2026</p>
                              <p>미리보기 전용 코드입니다.</p>
                              <button
                                className="button button--primary"
                                onClick={() => setConnection("connected")}
                              >
                                상대방 연결 완료 상태 보기
                              </button>
                            </>
                          ) : (
                            <>
                              <p>
                                <Check size={16} /> 샘플 보호자가 연결되어
                                있어요
                              </p>
                              <p>최근 활동 · 방금 전</p>
                              <button
                                className="button button--secondary"
                                onClick={() => setConnection("none")}
                              >
                                샘플 연결 해제
                              </button>
                            </>
                          )}
                        </Card>
                        <Card className="preview-section">
                          <h2>데이터 관리</h2>
                          <p>초기화 확인 화면을 확인해보세요.</p>
                          <button
                            className="button button--secondary"
                            onClick={() => setResetOpen(true)}
                          >
                            샘플 데이터 초기화
                          </button>
                        </Card>
                      </aside>
                    </div>
                  )}
                  {page === "check-in" &&
                    (checkIn && !empty ? (
                      <Card className="completion-panel">
                        <Check />
                        <h2>오늘의 안부를 기록했어요</h2>
                        <p>상담용 기록에서도 완료 상태를 볼 수 있어요.</p>
                        <button
                          className="button button--secondary"
                          onClick={() => setCheckIn(false)}
                        >
                          응답 다시 작성
                        </button>
                      </Card>
                    ) : (
                      <Card>
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            const started = generation.current;
                            setBusy(true);
                            await delay();
                            if (started !== generation.current) return;
                            setCheckIn(true);
                            setBusy(false);
                            message("샘플 안부를 저장했어요.");
                          }}
                        >
                          {[
                            "오늘 식사는 어떠셨나요?",
                            "지난밤은 잘 주무셨나요?",
                            "오늘 불편한 곳이 있나요?",
                          ].map((question, index) => (
                            <fieldset className="question-block" key={question}>
                              <legend>{question}</legend>
                              <div className="choice-grid">
                                {(index === 2
                                  ? [
                                      "불편하지 않아요",
                                      "조금 불편해요",
                                      "확인이 필요해요",
                                    ]
                                  : [
                                      "평소와 같아요",
                                      "평소보다 어려웠어요",
                                      "확인하지 못했어요",
                                    ]
                                ).map((answer) => (
                                  <label className="choice-card" key={answer}>
                                    <input
                                      type="radio"
                                      name={`question-${index}`}
                                      value={answer}
                                      required
                                    />
                                    <span>{answer}</span>
                                  </label>
                                ))}
                              </div>
                            </fieldset>
                          ))}
                          <label className="field">
                            함께 남길 메모
                            <textarea
                              placeholder="화면 확인용 메모를 입력하세요"
                              maxLength={500}
                            />
                          </label>
                          <button
                            className="button button--primary"
                            disabled={busy}
                          >
                            {busy ? "저장 중…" : "샘플 안부 저장"}
                          </button>
                        </form>
                      </Card>
                    ))}
                  {page === "report" && (
                    <Card>
                      <div className="section-heading">
                        <h2>{name}님의 상담용 기록</h2>
                        <button
                          className="button button--secondary"
                          onClick={() => window.print()}
                        >
                          인쇄하기
                        </button>
                      </div>
                      <p>{day} · UI 확인용 가상 기록</p>
                      <h3>현재 복용약</h3>
                      {shownMeds.length ? (
                        shownMeds.map((m) => (
                          <div className="preview-report-row" key={m.id}>
                            <strong>{m.productName}</strong>
                            <span>
                              {m.dose} · {m.frequency} · {m.timing}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p>등록된 약이 없어요.</p>
                      )}
                      <h3>최근 안부</h3>
                      <p>
                        {checkIn && !empty
                          ? "오늘 안부 확인 완료"
                          : "오늘 안부 확인 전"}
                      </p>
                      <h3>확인할 질환</h3>
                      <p>
                        {empty
                          ? "등록된 질환 없음"
                          : conditions.map((c) => c.standardName).join(", ") ||
                            "등록된 질환 없음"}
                      </p>
                      <h3>상담 때 물어볼 질문</h3>
                      <p>몸 상태 기록을 어떻게 정리하면 좋을까요? (샘플)</p>
                    </Card>
                  )}
                </>
              )}
            </div>
            <footer className="app-footer">
              미리보기에서 바꾼 내용은 이 화면에만 반영됩니다. 실제
              계정·처방·알림에 영향을 주지 않아요.
            </footer>
          </main>
        </div>
      </div>
      {resetOpen && (
        <ResetDialog cancel={() => setResetOpen(false)} reset={reset} />
      )}
    </>
  );
}
function Empty({ text, href }: { text: string; href: string }) {
  return (
    <div className="empty-state">
      <FileText size={28} />
      <h2>{text}</h2>
      <p>샘플 문서 또는 프로필을 등록해보세요.</p>
      <Link className="button button--primary" href={`/preview/${href}`}>
        등록 화면으로 이동
      </Link>
    </div>
  );
}

function ResetDialog({
  cancel,
  reset,
}: {
  cancel: () => void;
  reset: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="preview-dialog"
      aria-labelledby="preview-reset-title"
      onCancel={cancel}
    >
      <h2 id="preview-reset-title">샘플을 처음 상태로 되돌릴까요?</h2>
      <p>미리보기에서 수정한 내용이 초기화돼요.</p>
      <button className="button button--secondary" autoFocus onClick={cancel}>
        취소
      </button>
      <button className="button button--primary" onClick={reset}>
        초기화
      </button>
    </dialog>
  );
}
