# PWA 탐색과 새로고침

설치된 모바일 PWA의 하단 메뉴는 오늘 할 일·복용약·빠른 이동·식사/영양·프로필 순서다. 프로필은 상단에서 제거했고, 빠른 이동이 다섯 칸 중 가운데에 놓인다. 빠른 이동에는 복용 여부 기록, 오늘 몸 상태 기록, 처방전·약봉투 등록, 사진으로 약 검색이 있다.

하단 메뉴는 좌우와 바닥까지 흰 배경으로 채우며, 홈 인디케이터 영역에는 안전 여백을 둔다. 헤더, 테마 메타 태그, 설치 매니페스트의 테마/시작 배경색을 흰색으로 맞췄다. `viewport-fit=cover`와 안전 영역 여백으로 노치와 가로 회전에도 내용을 보호한다. iOS의 상태 표시줄 스타일은 밝은 헤더에 맞는 `default`를 유지한다. 데스크톱 사이드 메뉴는 유지한다.

모바일 앱 화면 맨 위에서 아래로 120 CSS px 이상 당겼다가 놓으면 현재 주소와 검색 매개변수를 유지하여 페이지를 새로고침한다. 당기는 중 안내와 새로고침 상태를 표시한다. 짧게 당기기, 가로 스와이프, 여러 손가락, 취소, 확대 상태, 중간 스크롤, 입력 컨트롤, 별도 스크롤 영역, 열린 모달에서는 새로고침을 시작하지 않는다. 화면 이동 시 이벤트 리스너를 정리한다.

브라우저 회귀 검사는 `front/e2e/pwa-shell.spec.ts`에서 Chromium/WebKit의 모바일 터치 환경으로 실행한다. 메뉴 이동·중앙 정렬·화면 가장자리·테마·접근성·320/390/768/1024/1440px·당기기 취소와 실제 페이지 재요청을 검사한다. 자동화된 DOM 터치 이벤트는 실제 기기에 설치한 PWA의 손가락 제스처나 OS 시스템 바를 재현한 것으로 간주하지 않는다.

구현 참고: [Next viewport 설정](https://nextjs.org/docs/app/api-reference/functions/generate-viewport), [Apple 상태 표시줄 메타 태그](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariHTMLRef/Articles/MetaTags.html), [MDN overscroll-behavior](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overscroll-behavior).

## 상태 표시줄 배경과 알림 위치

뒤에 불러오는 디자인 스타일이 html/body 배경을 회색으로 덮던 문제를 수정했다. 모바일 앱에서는 두 최상위 배경을 헤더와 같은 흰색으로 유지하고 콘텐츠 셸에만 회색을 적용한다. 복약 리마인더(다음 알림·기기 알림 켜기/끄기)와 알림 연결 안내는 프로필 페이지에서만 표시한다. 구독의 백그라운드 상태 확인은 기존 공통 Provider에서 유지한다.
