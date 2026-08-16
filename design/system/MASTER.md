# Design System Master File

> **LOGIC:** 페이지별 확장이 필요하면 `design/pages/[page-name].md`를 추가하고 이 문서를 기준으로 검토합니다.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Care Atlas
**Generated:** 2026-08-16 13:03:19
**Category:** Medication & Pill Reminder
**Design Dials:** Variance 4/10 (Balanced / Modern) | Motion 2/10 (Subtle) | Density 7/10 (Standard)

> 사용자 요청과 접근성 검토를 반영해 자동 추천의 파란색·영문 폰트·뉴스레터 패턴을 초록색 돌봄 대시보드와 Noto Sans KR로 수동 조정함.

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#176B4D` | `--color-primary` |
| On Primary | `#FFFFFF` | `--color-on-primary` |
| Secondary | `#91B79B` | `--color-secondary` |
| Accent/CTA | `#176B4D` | `--color-accent` |
| Background | `#F6F8F4` | `--color-background` |
| Foreground | `#18342A` | `--color-foreground` |
| Muted | `#E6EEE5` | `--color-muted` |
| Border | `#D9E3DA` | `--color-border` |
| Destructive | `#DC2626` | `--color-destructive` |
| Ring | `#176B4D` | `--color-ring` |

**Color Notes:** Deep green + light sage. 상태는 색상만이 아니라 아이콘과 텍스트를 함께 사용하며 본문 대비 4.5:1 이상을 유지한다.

### Typography

- **Heading Font:** Noto Sans KR
- **Body Font:** Noto Sans KR
- **Mood:** calm, wellness, health, relaxing, natural, organic
- **Google Fonts:** [Noto Sans KR](https://fonts.google.com/noto/specimen/Noto+Sans+KR)

**CSS Import:**
```css
font-family: "Noto Sans KR", "Apple SD Gothic Neo", sans-serif;
```

### Spacing Variables

*Density: 7/10 — Standard*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` / `0.25rem` | Tight gaps |
| `--space-sm` | `8px` / `0.5rem` | Icon gaps, inline spacing |
| `--space-md` | `16px` / `1rem` | Standard padding |
| `--space-lg` | `24px` / `1.5rem` | Section padding |
| `--space-xl` | `32px` / `2rem` | Large gaps |
| `--space-2xl` | `48px` / `3rem` | Section margins |
| `--space-3xl` | `64px` / `4rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, buttons |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: #176B4D;
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: #176B4D;
  border: 2px solid #176B4D;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: #FFFFFF;
  border-radius: 12px;
  padding: 24px;
  box-shadow: var(--shadow-md);
  transition: all 200ms ease;
  cursor: pointer;
}

.card:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-2px);
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 200ms ease;
}

.input:focus {
  border-color: #176B4D;
  outline: none;
  box-shadow: 0 0 0 3px #176B4D20;
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** Soft UI Evolution

**Keywords:** Evolved soft UI, better contrast, modern aesthetics, subtle depth, accessibility-focused, improved shadows, hybrid

**Best For:** Modern enterprise apps, SaaS platforms, health/wellness, modern business tools, professional, hybrid

**Key Effects:** Improved shadows (softer than flat, clearer than neumorphism), modern (200-300ms), focus visible, WCAG AA/AAA

### Page Pattern

**Pattern Name:** Caregiver Dashboard / Content First

- **Primary task:** 오늘의 복약·몸 상태 확인을 1분 안에 완료
- **CTA placement:** 대시보드 첫 카드와 모바일 하단 내비게이션의 안부 확인 메뉴
- **Section order:** 오늘의 안부 → 현재 복용약 → 7일 기록 → 확인할 신호 → 의료진 질문

---

## Motion

**Scroll Reveal** (Subtle) — Trigger: scroll (viewport enter) | Duration: 300-400ms | Easing: `power1.out`

```js
gsap.from(el, { opacity: 0, y: 12, duration: 0.35, ease: 'power1.out', scrollTrigger: { trigger: el, start: 'top 90%', toggleActions: 'play none none reverse' } });
```

**Framework notes:** Requires the ScrollTrigger plugin registered once via gsap.registerPlugin(ScrollTrigger)

- ✅ Keep the y offset small (8-16px) so it reads as a fade, not a slide
- ❌ Don't reveal below-the-fold content needed for SEO/crawlers as invisible-by-default without a no-JS fallback
- ⚡ toggleActions 'play none none reverse' avoids re-triggering on every scroll direction change

---

## Anti-Patterns (Do NOT Use)

- ❌ Complex shadows
- ❌ 3D effects
- ❌ Color-only indicators

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
