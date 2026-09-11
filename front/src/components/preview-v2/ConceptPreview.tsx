"use client";

import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileText,
  HeartPulse,
  Leaf,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  Pill,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  UploadCloud,
  UserRound,
  X,
} from "lucide-react";
import { useState, type ComponentType } from "react";

import { CareDiaryCalendar } from "@/components/dashboard/CareDiaryCalendar";
import styles from "./ConceptPreview.module.css";

type PageKey = "today" | "dashboard" | "medications" | "nutrition" | "check-in" | "documents" | "profile";
type Scenario = "filled" | "empty" | "loading" | "error";

type NavItem = {
  key: PageKey;
  label: string;
  shortLabel: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>;
};

const navItems: NavItem[] = [
  { key: "today", label: "오늘", shortLabel: "오늘", icon: Clock3 },
  { key: "dashboard", label: "돌봄 기록", shortLabel: "기록", icon: CalendarDays },
  { key: "medications", label: "복용약", shortLabel: "복용약", icon: Pill },
  { key: "nutrition", label: "식사·영양", shortLabel: "영양", icon: Leaf },
  { key: "check-in", label: "안부 확인", shortLabel: "안부", icon: ClipboardCheck },
  { key: "documents", label: "문서", shortLabel: "문서", icon: FileText },
  { key: "profile", label: "프로필", shortLabel: "내 정보", icon: UserRound },
];

const medicines = [
  { id: "amlodipine", name: "노바스크정 5mg", ingredient: "암로디핀베실산염", schedule: "매일 아침 식후 08:30", status: "복용 중" },
  { id: "dexibuprofen", name: "닥스펜정", ingredient: "덱시부프로펜", schedule: "필요할 때 1정", status: "필요시" },
  { id: "rebamipide", name: "무코스타정", ingredient: "레바미피드", schedule: "아침·저녁 식후", status: "복용 중" },
];

const doses = [
  { time: "08:30", name: "노바스크정 5mg", detail: "1정 · 아침 식후", state: "done" as const },
  { time: "13:00", name: "무코스타정", detail: "1정 · 점심 식후", state: "missed" as const },
  { time: "19:30", name: "무코스타정", detail: "1정 · 저녁 식후", state: "upcoming" as const },
];

const nutritionItems = [
  { source: "네이버 블로그", title: "혈압 관리를 위한 일주일 집밥 준비", publisher: "영양사의 식탁", summary: "국과 반찬의 나트륨을 줄이면서 한 끼 구성을 유지하는 실제 조리 순서를 정리한 글이에요.", time: "읽기 6분" },
  { source: "YouTube", title: "외식 메뉴에서 나트륨을 줄이는 선택법", publisher: "건강한끼 연구소", summary: "찌개, 면, 구이 메뉴를 고를 때 바로 확인할 수 있는 기준을 영양사가 설명해요.", time: "영상 8분" },
  { source: "병원 건강정보", title: "고혈압 식사에서 자주 묻는 질문", publisher: "샘플 대학병원", summary: "과일, 커피, 국물 섭취에 관한 일반적인 질문과 상담이 필요한 상황을 다뤄요.", time: "읽기 4분" },
];

const cx = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");

function SectionHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <span className={styles.eyebrow}>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action ? <div className={styles.headerAction}>{action}</div> : null}
    </header>
  );
}

function StateFrame({ scenario, children, onReset }: { scenario: Scenario; children: React.ReactNode; onReset: () => void }) {
  if (scenario === "loading") {
    return (
      <div className={styles.statePanel} role="status">
        <LoaderCircle className={styles.spinner} size={28} aria-hidden />
        <strong>돌봄 정보를 정리하고 있어요</strong>
        <span>잠시만 기다려주세요.</span>
        <div className={styles.skeleton}><i /><i /><i /></div>
      </div>
    );
  }
  if (scenario === "error") {
    return (
      <div className={cx(styles.statePanel, styles.errorPanel)} role="alert">
        <AlertTriangle size={28} aria-hidden />
        <strong>정보를 불러오지 못했어요</strong>
        <span>저장된 기록은 그대로예요. 잠시 후 다시 시도해주세요.</span>
        <button className={styles.primaryButton} onClick={onReset}>다시 시도</button>
      </div>
    );
  }
  return children;
}

function TodayView({ empty }: { empty: boolean }) {
  return (
    <>
      <SectionHeader eyebrow="9월 10일 목요일" title="오늘 복용할 것" description="복용 시간과 확인이 필요한 기록을 한곳에서 살펴보세요." action={<button className={styles.primaryButton}>복약 체크하기</button>} />
      <div className={styles.todaySummary}>
        <div><span>오늘 일정</span><strong>{empty ? "0" : "3"}<small>회</small></strong></div>
        <div><span>복용 완료</span><strong>{empty ? "0" : "1"}<small>회</small></strong></div>
        <div className={styles.nextDose}><span>다음 복용</span><strong>{empty ? "등록된 일정 없음" : "저녁 7:30 · 무코스타정"}</strong></div>
      </div>
      <section className={styles.contentSection}>
        <div className={styles.sectionTitle}><div><h2>복약 일정</h2><p>시간순으로 정리했어요.</p></div><button className={styles.iconButton} aria-label="복약 일정 더보기"><MoreHorizontal size={20} /></button></div>
        {empty ? <EmptyState icon={Pill} title="오늘 복용할 약이 없어요" body="처방전이나 약봉투를 등록하면 일정이 여기에 나타나요." action="문서 등록하기" /> : (
          <ol className={styles.doseList}>
            {doses.map((dose) => <DoseRow key={`${dose.time}-${dose.name}`} {...dose} />)}
          </ol>
        )}
      </section>
    </>
  );
}

function DoseRow({ time, name, detail, state }: (typeof doses)[number]) {
  const stateInfo = state === "done"
    ? { label: "복용 완료", icon: Check, className: styles.done }
    : state === "missed"
      ? { label: "미복용", icon: X, className: styles.missed }
      : { label: "복용 예정", icon: Clock3, className: styles.upcoming };
  const Icon = stateInfo.icon;
  return (
    <li className={styles.doseRow}>
      <time>{time}</time>
      <div><strong>{name}</strong><span>{detail}</span></div>
      <span className={cx(styles.stateIcon, stateInfo.className)} title={stateInfo.label}><Icon size={22} strokeWidth={2.6} /><i>{stateInfo.label}</i></span>
      <ChevronRight className={styles.rowArrow} size={18} aria-hidden />
    </li>
  );
}

function DashboardView() {
  return (
    <>
      <SectionHeader eyebrow="돌봄 기록" title="한 달의 흐름" description="달력은 현재 동작과 모습을 유지하고, 주변 정보 구조만 새 시안에 맞췄습니다." />
      <div className={styles.dashboardStrip}>
        <div><span>복용 확인</span><strong>87%</strong><small>지난달보다 4% 높아요</small></div>
        <div><span>확인 필요</span><strong>2건</strong><small>기록을 확인해주세요</small></div>
        <div><span>최근 안부</span><strong>괜찮음</strong><small>오늘 오전 9:12</small></div>
      </div>
      <section className={cx(styles.contentSection, styles.calendarSection)}>
        <CareDiaryCalendar
          initialDate="2026-09-10"
          medications={[{ id: "preview-med", productName: medicines[0].name, frequency: "하루 1회", timing: "아침 식후 08:30", startDate: "2026-01-01" }]}
          doses={[{ id: "preview-dose", medicationPlanId: "preview-med", scheduledAt: "2026-09-10T08:30:00+09:00", response: "completed", answeredBy: "caregiver" }]}
          symptoms={[]}
          revision={1}
        />
      </section>
    </>
  );
}

function MedicationsView({ empty }: { empty: boolean }) {
  const [selected, setSelected] = useState(medicines[0].id);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(1);
  const medication = medicines.find((item) => item.id === selected) ?? medicines[0];
  return (
    <>
      <SectionHeader eyebrow="복용약" title="복용 중인 약" description="약 목록과 쉬운 설명을 같은 화면에서 확인하세요." action={<button className={styles.primaryButton} onClick={() => setWizardOpen(true)}><Plus size={17} /> 약 추가</button>} />
      {empty ? <EmptyState icon={Pill} title="등록한 약이 없어요" body="약 이름을 검색하거나 문서에서 복용약을 가져올 수 있어요." action="약 추가하기" /> : (
        <div className={styles.masterDetail}>
          <div className={styles.recordList} role="listbox" aria-label="복용약 목록">
            <div className={styles.inlineSearch}><Search size={18} /><input aria-label="등록된 약 검색" placeholder="등록된 약 찾기" /></div>
            {medicines.map((item) => (
              <button key={item.id} className={cx(styles.recordRow, selected === item.id && styles.selectedRow)} onClick={() => setSelected(item.id)} role="option" aria-selected={selected === item.id}>
                <span><strong>{item.name}</strong><small>{item.schedule}</small></span><ChevronRight size={18} />
              </button>
            ))}
          </div>
          <article className={styles.detailPane}>
            <div className={styles.detailHeading}><div><span>{medication.status}</span><h2>{medication.name}</h2><p>{medication.ingredient}</p></div><button className={styles.iconButton} aria-label="약 메뉴"><MoreHorizontal size={20} /></button></div>
            <div className={styles.explanation}><span>이 약을 쉽게 설명하면</span><p>혈압을 낮추고 심장이 혈액을 보내는 부담을 덜어주는 데 사용하는 약이에요.</p></div>
            <dl className={styles.definitionList}><div><dt>한 번에</dt><dd>1정</dd></div><div><dt>복용 주기</dt><dd>하루 1회</dd></div><div><dt>먹는 시점</dt><dd>아침 식후 08:30</dd></div></dl>
            <div className={styles.detailBlock}><h3>흔히 느낄 수 있는 변화</h3><p>처음에는 어지러움이나 얼굴이 화끈거리는 느낌이 있을 수 있어요. 불편함이 계속되면 의료진에게 알려주세요.</p></div>
          </article>
        </div>
      )}
      {wizardOpen ? <MedicationWizard step={step} setStep={setStep} onClose={() => { setWizardOpen(false); setStep(1); }} /> : null}
    </>
  );
}

function MedicationWizard({ step, setStep, onClose }: { step: number; setStep: (step: number) => void; onClose: () => void }) {
  return (
    <div className={styles.scrim} role="presentation">
      <section className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="add-medication-title">
        <div className={styles.drawerHeader}><div><span>약 추가 · {step}/3</span><h2 id="add-medication-title">{step === 1 ? "약을 찾아볼게요" : step === 2 ? "복용 방법을 선택해주세요" : "추가할 내용을 확인해주세요"}</h2></div><button className={styles.iconButton} onClick={onClose} aria-label="닫기"><X size={20} /></button></div>
        <div className={styles.stepTrack} aria-hidden><i className={styles.stepActive} /><i className={step > 1 ? styles.stepActive : ""} /><i className={step > 2 ? styles.stepActive : ""} /></div>
        <div className={styles.drawerBody}>
          {step === 1 ? <><label className={styles.fieldLabel}>제품명</label><div className={styles.searchField}><Search size={19} /><input defaultValue="노바스크정" /></div><button className={cx(styles.searchResult, styles.searchResultSelected)}><span><strong>노바스크정5밀리그램</strong><small>암로디핀베실산염 · 샘플 제약</small></span><Check size={19} /></button></> : null}
          {step === 2 ? <div className={styles.formGrid}><SelectField label="한 번에" value="1정" options={["0.5정", "1정", "2정"]} /><SelectField label="복용 주기" value="하루 1회" options={["하루 1회", "하루 2회", "필요할 때"]} /><SelectField label="먹는 시점" value="아침 식후" options={["아침 식전", "아침 식후", "저녁 식후"]} /><label className={styles.field}><span>시간</span><input type="time" defaultValue="08:30" /></label></div> : null}
          {step === 3 ? <div className={styles.reviewList}><div><span>약 이름</span><strong>노바스크정 5mg</strong></div><div><span>복용량</span><strong>한 번에 1정</strong></div><div><span>일정</span><strong>매일 아침 식후 08:30</strong></div><p><ShieldCheck size={18} /> 추가하면 오늘 일정과 달력에 함께 반영돼요.</p></div> : null}
        </div>
        <footer className={styles.drawerFooter}>{step > 1 ? <button className={styles.secondaryButton} onClick={() => setStep(step - 1)}>이전</button> : <span />}<button className={styles.primaryButton} onClick={() => step < 3 ? setStep(step + 1) : onClose()}>{step < 3 ? "계속" : "이 약 추가"}</button></footer>
      </section>
    </div>
  );
}

function DocumentsView({ empty }: { empty: boolean }) {
  const [analyzing, setAnalyzing] = useState(false);
  return (
    <>
      <SectionHeader eyebrow="문서" title="문서에서 바로 시작하기" description="처방전과 약봉투를 올리면 확인할 내용을 순서대로 보여드려요." />
      <div className={styles.documentGrid}>
        <section className={styles.uploadPanel}>
          <ol className={styles.steps}><li className={styles.currentStep}><span>1</span><strong>문서 선택</strong></li><li><span>2</span><strong>내용 확인</strong></li><li><span>3</span><strong>등록 완료</strong></li></ol>
          <div className={styles.segmented}><button className={styles.segmentActive}>처방전</button><button>약봉투</button><button>진단서</button></div>
          <button className={styles.dropzone} onClick={() => setAnalyzing(true)}><UploadCloud size={30} /><strong>파일을 놓거나 눌러서 선택</strong><span>PDF, JPG, PNG · 최대 10MB</span></button>
          <button className={styles.primaryButton} onClick={() => setAnalyzing(true)}>문서 분석하기</button>
        </section>
        <aside className={styles.activityPanel}><span className={styles.eyebrow}>최근 문서</span>{empty ? <p className={styles.muted}>아직 등록된 문서가 없어요.</p> : ["9월 처방전.pdf", "퇴원 약봉투.jpg", "건강검진 진단서.pdf"].map((name, index) => <div className={styles.documentRow} key={name}><FileText size={19} /><span><strong>{name}</strong><small>{index === 0 ? "오늘" : `${index + 1}일 전`}</small></span><ChevronRight size={17} /></div>)}</aside>
      </div>
      {analyzing ? <div className={styles.processBar} role="status"><LoaderCircle className={styles.spinner} size={21} /><div><strong>약 이름과 복용 방법을 확인하고 있어요</strong><span>현재 2/4 단계 · 일정 만들기</span></div><button onClick={() => setAnalyzing(false)}>완료 상태 보기</button></div> : null}
    </>
  );
}

function NutritionView({ empty }: { empty: boolean }) {
  const [filter, setFilter] = useState("전체");
  return (
    <>
      <SectionHeader eyebrow="식사·영양" title="고혈압 식사 자료" description="검색 대신 읽을 만한 한국어 자료를 한곳에 모았어요." />
      <div className={styles.searchHero}><div className={styles.searchField}><Search size={20} /><input aria-label="질환 또는 식사 주제 검색" defaultValue="고혈압 식단" /><button>찾기</button></div><div className={styles.filterBar}>{["전체", "네이버", "YouTube", "전문 자료"].map((item) => <button key={item} className={filter === item ? styles.filterActive : ""} onClick={() => setFilter(item)}>{item}</button>)}</div></div>
      <section className={styles.contentSection}>
        <div className={styles.sectionTitle}><div><h2>살펴볼 자료</h2><p>관련성과 읽기 쉬운 정도를 기준으로 정리했어요.</p></div><span className={styles.resultCount}>{empty ? 0 : nutritionItems.length}개</span></div>
        {empty ? <EmptyState icon={Search} title="검색 결과가 없어요" body="질환명이나 식사 주제를 조금 다르게 입력해보세요." action="추천 검색어 보기" /> : <div className={styles.resourceList}>{nutritionItems.map((item) => <article className={styles.resourceRow} key={item.title}><div className={styles.resourceMeta}><span>{item.source}</span><small>{item.time}</small></div><div><h3>{item.title}</h3><p>{item.summary}</p><small>{item.publisher}</small></div><ChevronRight size={20} /></article>)}</div>}
      </section>
    </>
  );
}

function CheckInView() {
  const [answer, setAnswer] = useState("괜찮아요");
  return (
    <>
      <SectionHeader eyebrow="안부 확인" title="오늘 몸 상태는 어떠세요?" description="답변은 보호자와 연결된 돌봄 기록에 저장돼요." />
      <section className={styles.questionFlow}>
        <div className={styles.questionProgress}><span>1 / 3</span><progress value="1" max="3" /></div>
        <h2>평소와 비교해 몸 상태가 어떤가요?</h2>
        <div className={styles.answerRows}>{["좋아요", "괜찮아요", "조금 불편해요", "많이 불편해요"].map((item) => <button key={item} className={answer === item ? styles.answerSelected : ""} onClick={() => setAnswer(item)}><span>{item}</span>{answer === item ? <Check size={20} /> : null}</button>)}</div>
        <div className={styles.flowActions}><button className={styles.secondaryButton}>나중에</button><button className={styles.primaryButton}>다음 질문</button></div>
      </section>
    </>
  );
}

function ProfileView() {
  const [section, setSection] = useState("기본 정보");
  const [dirty, setDirty] = useState(false);
  return (
    <>
      <SectionHeader eyebrow="프로필" title="돌봄 설정" description="내 정보와 연결된 보호자, 건강 정보를 관리하세요." />
      <div className={styles.settingsLayout}>
        <nav className={styles.settingsNav} aria-label="프로필 설정">{["기본 정보", "건강 정보", "돌봄 연결", "알림 설정"].map((item) => <button key={item} className={section === item ? styles.settingsActive : ""} onClick={() => setSection(item)}>{item}<ChevronRight size={16} /></button>)}</nav>
        <section className={styles.settingsPanel}>
          <div className={styles.sectionTitle}><div><h2>{section}</h2><p>{section === "돌봄 연결" ? "가족과 복약 기록을 함께 확인할 수 있어요." : "돌봄에 사용하는 정보를 확인하고 변경하세요."}</p></div></div>
          {section === "돌봄 연결" ? <div className={styles.connectionPanel}><div><UserRound size={22} /><span><strong>박보호자</strong><small>연결됨 · 오늘 오전 동기화</small></span></div><dl><div><dt>확인 가능한 정보</dt><dd>복약 일정, 안부 기록</dd></div><div><dt>연결한 날</dt><dd>2026년 8월 24일</dd></div></dl><button className={styles.secondaryButton}>연결 관리</button></div> : <div className={styles.formStack}><label className={styles.field}><span>이름</span><input defaultValue="김샘플" onChange={() => setDirty(true)} /></label><label className={styles.field}><span>출생 연도</span><input defaultValue="1958" onChange={() => setDirty(true)} /></label><label className={styles.field}><span>연락처</span><input defaultValue="010-1234-5678" onChange={() => setDirty(true)} /></label></div>}
        </section>
      </div>
      {dirty ? <div className={styles.saveBar}><span>저장하지 않은 변경사항이 있어요.</span><div><button className={styles.secondaryButton} onClick={() => setDirty(false)}>취소</button><button className={styles.primaryButton} onClick={() => setDirty(false)}>변경사항 저장</button></div></div> : null}
    </>
  );
}

function EmptyState({ icon: Icon, title, body, action }: { icon: ComponentType<{ size?: number }>; title: string; body: string; action: string }) {
  return <div className={styles.emptyState}><Icon size={28} /><strong>{title}</strong><p>{body}</p><button className={styles.secondaryButton}>{action}</button></div>;
}

function SelectField({ label, value, options }: { label: string; value: string; options: string[] }) {
  return <label className={styles.field}><span>{label}</span><select defaultValue={value}>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}

export function ConceptPreview() {
  const [page, setPage] = useState<PageKey>("today");
  const [scenario, setScenario] = useState<Scenario>("filled");
  const [rail, setRail] = useState(false);
  const selectedNav = navItems.find((item) => item.key === page) ?? navItems[0];

  const content = page === "today" ? <TodayView empty={scenario === "empty"} />
    : page === "dashboard" ? <DashboardView />
      : page === "medications" ? <MedicationsView empty={scenario === "empty"} />
        : page === "nutrition" ? <NutritionView empty={scenario === "empty"} />
          : page === "documents" ? <DocumentsView empty={scenario === "empty"} />
            : page === "profile" ? <ProfileView />
              : <CheckInView />;

  return (
    <div className={cx(styles.preview, rail && styles.railMode)}>
      <aside className={styles.sidebar}>
        <button className={styles.brand} onClick={() => setPage("today")} aria-label="오늘 화면"><HeartPulse size={24} strokeWidth={2.4} /><span><strong>IPILLGOOD</strong><small>돌봄을 한눈에</small></span></button>
        <nav className={styles.navigation} aria-label="서비스 메뉴">{navItems.map(({ key, label, icon: Icon }) => <button key={key} className={page === key ? styles.activeNav : ""} onClick={() => setPage(key)}><Icon size={20} /><span>{label}</span>{page === key ? <i /> : null}</button>)}</nav>
        <div className={styles.sidebarFooter}><button onClick={() => setRail(!rail)}><Menu size={19} /><span>{rail ? "메뉴 펼치기" : "메뉴 접기"}</span></button><div><span>김샘플</span><small>데모 프로필</small></div></div>
      </aside>
      <div className={styles.workspace}>
        <div className={styles.previewBar}>
          <div><span className={styles.previewMark}>CONCEPT 02</span><strong>App UI 구조 적용 시안</strong><small>실제 서비스에는 아직 적용되지 않았습니다.</small></div>
          <label>화면 상태<select value={scenario} onChange={(event) => setScenario(event.target.value as Scenario)}><option value="filled">데이터 있음</option><option value="empty">데이터 없음</option><option value="loading">불러오는 중</option><option value="error">오류</option></select></label>
        </div>
        <header className={styles.mobileHeader}><button className={styles.mobileBrand} onClick={() => setPage("today")}><HeartPulse size={22} /><strong>IPILLGOOD</strong></button><span>{selectedNav.label}</span><button className={styles.iconButton} aria-label="설정" onClick={() => setPage("profile")}><Settings size={19} /></button></header>
        <main className={styles.main}>
          <StateFrame scenario={scenario} onReset={() => setScenario("filled")}>{content}</StateFrame>
        </main>
      </div>
      <nav className={styles.mobileNav} aria-label="모바일 메뉴">{navItems.filter((item) => item.key !== "profile").map(({ key, shortLabel, icon: Icon }) => <button key={key} className={page === key ? styles.mobileActive : ""} onClick={() => setPage(key)}><Icon size={20} /><span>{shortLabel}</span>{page === key ? <i /> : null}</button>)}</nav>
    </div>
  );
}
