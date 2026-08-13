# 배포와 운영

## 구조 — 왜 두 페이지로 나눴나

```
https://<사용자>.github.io/<저장소>/          소개·사용법  (광고 O)
https://<사용자>.github.io/<저장소>/app/      실제 앱      (광고 X)
```

광고를 넣으려면 구글 스크립트를 페이지에 불러와야 합니다. 그 스크립트는 같은 페이지 안에서
도는 남의 코드라 **화면에 떠 있는 학생 명단을 읽을 수 있습니다.** 감사까지 해가며 막은 게
정확히 그 경로입니다.

그래서 명렬표가 절대 올라가지 않는 소개 페이지에만 광고를 두고, 앱은 외부 스크립트 로드를
아예 금지하는 정책을 그대로 유지합니다. **광고 스크립트가 학생 데이터를 볼 수 있는 화면에
들어갈 방법이 구조적으로 없습니다.**

덤으로 애드센스 승인에도 유리합니다. 화면 몇 개짜리 도구는 「low value content」로 반려되는
경우가 많은데, 사용법과 팁이 있는 소개 페이지는 심사에 훨씬 유리합니다.

---

## 1. GitHub에 올리기

```bash
cd C:\Users\pc\dev\seat-planner
git remote add origin https://github.com/<사용자>/<저장소>.git
git branch -M main
git push -u origin main
```

> 저장소는 **공개(Public)** 로 만드세요. GitHub Pages 무료 배포에 필요합니다.
> `.gitignore` 가 `*.xlsx`·`*.csv` 를 막고 있어 실제 명렬표는 올라가지 않습니다.

## 2. Pages 켜기

저장소 **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 바꿉니다.

이후 `main` 에 push할 때마다 `.github/workflows/deploy.yml` 이
타입 검사 → 단위 테스트 192개 → 앱 빌드 → 브라우저 테스트 28개 → 배포 순으로 실행합니다.
**테스트가 실패하면 배포되지 않습니다.**

## 3. 피드백 창구 만들기

1. [Google Forms](https://docs.google.com/forms) 에서 새 양식을 만듭니다
2. 다음 항목을 권합니다
   - 어떤 화면에서 생긴 일인가요 *(객관식: 불러오기 / 명단 / 교실 / 조건 / 만들기 / 결과)*
   - 무엇이 안 되나요, 어떤 기능이 있으면 좋겠나요 *(장문)*
   - 화면 사진 *(파일 업로드)* — **응답자 로그인이 필요합니다**
   - 진단 정보 붙여넣기 *(장문)*
3. **보내기 → 링크** 주소를 복사해 `src/config/links.ts` 의 `FEEDBACK_FORM` 에 넣습니다
4. push 하면 앱의 «의견 보내기» 에 버튼이 생깁니다

주소를 넣기 전에는 버튼 대신 안내 문구가 나오므로 죽은 링크가 보이지 않습니다.

### 스크린샷 안전장치

선생님들이 그냥 캡처하면 **학생 이름이 그대로 찍힙니다.** 그래서 앱의 «의견 보내기» 안에
**«이름 가린 화면 저장»** 을 넣었습니다. 배치 모양·모둠 색·좌석 구조는 그대로 두고
이름만 `학생01`·`학생02` 로 바꾼 PNG 를 만들어 줍니다. 교사 메모·배려 사항·모둠 역할·
태그·사용자 정의 항목도 전부 빠집니다.

진단 정보(앱 버전·화면·학생 수·교실 크기·모둠 구성·조건 수·시드)도 함께 만들어 주며,
여기에도 이름은 들어가지 않습니다. 둘 다 단위 테스트와 브라우저 테스트로 고정되어 있습니다.

---

## 4. 애드센스 (승인 후)

### 넣는 곳

`site/index.html` 의 `<head>` 주석을 풀고 게시자 ID를 바꿉니다.

```html
<script async
  src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-본인ID"
  crossorigin="anonymous"></script>
```

광고 단위는 `<div class="ad-slot">` 두 곳에 넣으면 됩니다.

### 절대 넣지 말아야 할 곳

**`src/` 아래 어디에도 넣지 마세요.** 앱의 CSP `script-src 'self'` 가 차단하므로 광고가
뜨지도 않고, 억지로 CSP를 열면 PRIVACY.md 의 주장이 전부 거짓이 됩니다.
단위 테스트가 `src/` 의 외부 URL을 검출해 실패시키므로 실수로 들어가도 CI에서 걸립니다.

### 준비물

- `site/privacy.html` — 광고·쿠키 조항이 이미 들어 있습니다 *(애드센스 필수 요건)*
- `ads.txt` — 승인 후 `site/ads.txt` 로 만들면 자동 배포됩니다
- 소유권 확인 — 애드센스가 주는 메타 태그를 `site/index.html` `<head>` 에 넣습니다

### 현실적인 조언

단일 도구 페이지는 반려되는 일이 흔합니다. 소개 페이지에 **사용법·자리배치 노하우·
모둠 활동 팁** 같은 글을 몇 개 올린 뒤 신청하시는 편이 승인 확률이 높습니다.

---

## 5. 헤더를 보낼 수 있는 호스트에 올린다면

GitHub Pages 는 응답 헤더를 보낼 수 없어 `frame-ancestors` 가 적용되지 않습니다
(meta 태그에서는 명세상 무시됨). 즉 **다른 사이트가 앱을 iframe 으로 감쌀 수 있습니다.**

Netlify·Cloudflare Pages 에 올리면 `site/_headers` 가 자동 적용되어 이 문제가 사라집니다.
빌드 명령은 `npm run build`, 게시 폴더는 `dist` 입니다.

---

## 6. 로컬에서 배포본 확인

```bash
npm run build
```

```bash
npx serve dist
```

`http://localhost:3000` 에서 소개 페이지가, `/app/` 에서 앱이 열립니다.
