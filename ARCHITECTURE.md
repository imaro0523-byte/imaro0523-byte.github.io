# 구조

## 큰 그림

```
브라우저 탭 하나가 전부입니다.

  엑셀 파일 ──▶ core/excel ──▶ Student[] (UUID)
                                   │
   교실 설정 ──▶ core/layout ──▶ Classroom (정본 좌표)
                                   │
   조건 카드 ──▶ core/constraints ──┤
                                   ▼
                            core/solver  ── Web Worker
                                   │
                                   ▼
              SeatAssignment · Grouping ──▶ 화면 · 내보내기
```

바깥으로 나가는 화살표가 없습니다. 이것이 이 프로젝트의 구조적 특징입니다.

---

## 폴더

```
src/
├─ core/                      순수 TypeScript. React·DOM·브라우저 전역 없음
│  ├─ model/       types.ts · normalize.ts · ids.ts
│  ├─ excel/       grid · detectHeader · parseRoster · meta · importRoster · readWorkbook
│  ├─ layout/      grid · viewpoint · adjacency
│  ├─ constraints/ kinds · evaluate · diagnose
│  ├─ solver/      rng · partition · seating · grouping
│  ├─ history/     index(집계) · record(기록·매칭)
│  └─ exportData/  redact · toJson · toXlsx
├─ workers/        solver.worker.ts
├─ store/          useAppStore.ts (Zustand + undo/redo)
├─ lib/            log · storage · sample · solverClient
└─ ui/
   ├─ screens/     Import · Roster · Classroom · Rules · Generate · Result
   ├─ components/  SeatMap · RevealBar · GroupList · SettingsPanel · PrivacyNotice · Icons
   └─ export/      download · image (PNG·JPG·PDF)
```

---

## 왜 `core/` 를 격리했나

`src/core/` 아래 모든 파일은 `react`, `document`, `window`, `localStorage` 를
import하거나 참조하지 않습니다. 이 규칙은 관례가 아니라 **테스트로 강제**됩니다
(`tests/unit/privacy.test.ts`).

얻는 것이 세 가지 있습니다.

1. **Node에서 그대로 테스트할 수 있습니다.** jsdom 없이 124개 단위 테스트가 몇 초 만에 돕니다.
2. **Web Worker에 그대로 넣을 수 있습니다.** 솔버 워커는 `core/solver` 를 import할 뿐,
   별도 이식 작업이 없습니다.
3. **UI 버그가 배치 결과를 오염시킬 수 없습니다.** 자리 계산은 순수 함수라 화면 상태와
   무관하게 같은 입력에 같은 출력을 냅니다.

---

## 좌표계 — 하나만 쓴다

가장 중요한 설계 결정입니다.

**모든 저장 좌표는 «학생 관점»** 입니다. `row 0` 은 칠판에 가장 가까운 앞줄이고,
열은 앉은 학생이 보는 방향으로 왼쪽에서 오른쪽입니다.

교사 관점은 **화면에 그릴 때만** 적용되는 180° 회전입니다.

```ts
// core/layout/viewpoint.ts — 전부입니다
teacher: (row, col) → (rows-1-row, cols-1-col)
student: (row, col) → (row, col)
```

한 번의 회전이 위아래와 좌우를 동시에 뒤집기 때문에 "교사의 왼쪽 = 학생의 오른쪽"이
특별한 처리 없이 맞아떨어집니다. 회전이 자기 자신의 역함수라는 점도 유용합니다 —
화면 좌표를 정본으로 되돌릴 때 같은 함수를 씁니다.

인접 관계·제약 판정·솔버·과거 기록·내보내기는 **전부 정본 좌표에서만** 동작합니다.
그래서 보기를 바꿔도 결과가 달라질 수 없고, 이 사실을 E2E 테스트가
"두 관점의 좌석 순서가 정확히 서로의 역순"임을 확인해 고정합니다.

---

## 학생 식별 — 이름은 키가 아니다

`Student.id` 는 항상 `crypto.randomUUID()` 입니다. 이름은 표시용 속성일 뿐입니다.

한 반에 동명이인이 있는 것은 드문 일이 아니고, 이름을 키로 쓰면 두 학생이 조용히 하나로
합쳐집니다. 그래서 가져오기 단계에서 UUID를 부여하고, 이후 모든 참조는 UUID로만 합니다.

과거 기록을 새로 가져온 명단에 연결할 때는 다음 순서를 따릅니다
(`core/history/record.ts`).

1. 같은 프로젝트 안이면 UUID가 그대로 일치
2. 다시 가져왔다면 출석번호로 연결 — 단, **후보가 정확히 하나일 때만**
3. 이름은 교사가 명시적으로 허용했을 때만, 그리고 역시 후보가 하나일 때만
4. 애매하면 연결하지 않고 교사에게 넘김

---

## 상태 관리

Zustand 스토어 하나에 모여 있습니다. 스냅샷 기반 undo/redo(최대 40단계)를 쓰며,
되돌릴 대상은 `students · classroom · constraints · assignment · grouping` 다섯 가지입니다.

«자리 만들기» 화면의 모둠 설정도 스토어에 있습니다. 처음에는 화면 로컬 상태였는데,
학생 한 명을 고치러 명단 화면에 갔다 오면 방금 고른 모둠 설정이 통째로 사라졌습니다.
E2E 테스트가 이를 잡아냈고, 스토어로 옮겼습니다.

---

## 계산을 워커에서 돌리는 이유와 대비책

«정밀 생성»은 최대 3초까지 탐색합니다. 메인 스레드에서 돌리면 그동안 화면이 멈춥니다.
그래서 `src/workers/solver.worker.ts` 에서 실행합니다.

다만 학교 PC의 잠긴 브라우저 설정처럼 워커를 만들 수 없는 환경이 있습니다.
`lib/solverClient.ts` 는 그런 경우와 워커가 20초 안에 응답하지 않는 경우 모두
**메인 스레드 계산으로 자동 전환**합니다. 버튼이 영원히 도는 상태가 생기지 않습니다.

워커가 돌려보내는 오류에는 메시지만 담고 payload를 싣지 않습니다.
오류 객체를 통해 학생 데이터가 흘러나오지 않게 하기 위해서입니다.

---

## 내보내기 계층

```
현재 상태 ──▶ redact.ts ──▶ toJson / toXlsx / image
                  │
             ExportOptions
        (기본값은 전부 false)
```

축약 규칙을 각 내보내기 함수에 흩어 놓지 않고 `redact.ts` 한 곳에 모았습니다.
"학생용 PDF에 교사 메모가 들어가면 안 된다"가 네 군데에 반복되는 약속이 아니라
한 개의 테스트 가능한 규칙이 됩니다.

JSON 백업은 `Student` 를 통째로 직렬화하지 않고 **필드를 하나씩 명시적으로 옮깁니다.**
나중에 `Student` 에 민감한 필드가 추가되었을 때, 여기를 고치는 것을 잊어도
자동으로 새 필드가 새어 나가지 않게 하기 위해서입니다.

---

## 의존성을 고른 기준

| 라이브러리 | 쓰는 이유 |
| --- | --- |
| **SheetJS(xlsx) 0.20.3** | 브라우저 안 엑셀 읽기·쓰기. npm 레지스트리 판(0.18.5)은 알려진 취약점이 있어 SheetJS 공식 배포판을 씁니다. 빌드 시점 의존성일 뿐 실행 중 통신은 없습니다. |
| **html-to-image + jsPDF** | 브라우저 렌더러로 PNG·PDF 생성 |
| **Zustand** | 작은 상태 관리. 미들웨어·영속화 플러그인 없이 저장 시점을 직접 통제하기 위해 |
| **Tailwind** | 스타일. 외부 폰트·아이콘 CDN을 쓰지 않습니다 |
| **Vitest / Playwright** | 테스트 |
| **vite-plugin-pwa** | 오프라인 동작 |

아이콘은 CDN이나 아이콘 폰트 대신 `ui/components/Icons.tsx` 에 인라인 SVG로 직접 그렸습니다.
글꼴도 시스템 글꼴만 씁니다. 이 앱이 하지 말아야 할 단 하나의 네트워크 요청이
글꼴 요청이기 때문입니다.
