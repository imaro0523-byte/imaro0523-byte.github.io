/**
 * The only outward-pointing addresses in the application.
 *
 * These are destinations a teacher clicks, opened in a new tab. Nothing is ever
 * sent to them automatically, and no application data is appended to the URL —
 * that rule is enforced by `tests/unit/privacy.test.ts`, which requires every
 * link here to be a bare address with no query string.
 *
 * This file is the one place the privacy source scan permits an external URL.
 * Adding one anywhere else in `src/` fails the test suite.
 *
 * ── 설정 방법 ──────────────────────────────────────────────────────────
 * 구글 폼을 만든 뒤 «보내기 → 링크» 주소를 FEEDBACK_FORM 에 넣으세요.
 * 비워 두면 앱은 링크 대신 «아직 준비되지 않았습니다» 안내를 보여 줍니다.
 *
 * 주소 끝의 ?usp=publish-editor 같은 꼬리표는 반드시 떼고 넣으세요. 편집 화면에서
 * 복사하면 따라붙는데, 그대로 두면 아래 테스트가 막습니다 — 링크에 쿼리스트링을
 * 허용하는 순간 데이터가 편승할 자리가 생기기 때문입니다.
 *
 * 폼에는 다음 항목을 권합니다.
 *   1. 어떤 화면에서 생긴 일인가요 (객관식)
 *   2. 무엇이 안 되나요 / 어떤 기능이 있으면 좋겠나요 (장문)
 *   3. 화면 사진 (파일 업로드) — 앱의 «이름 가린 화면 저장» 으로 만든 파일
 *   4. 진단 정보 붙여넣기 (장문) — 앱이 만들어 주는 텍스트
 * ─────────────────────────────────────────────────────────────────────
 */

/** Google Form for bug reports and feature requests. Empty until configured. */
export const FEEDBACK_FORM =
  'https://docs.google.com/forms/d/e/1FAIpQLSfFHmv8kvGm89LOousl9CSZdlSBJn2iWyGmQ37j2A3-ITYbgw/viewform';

/**
 * Project home. Nothing in the application reads this yet — the guide site is
 * plain HTML and links to the repository directly. Kept as the single declared
 * place for the address, so a future in-app link has somewhere to read it from.
 */
export const PROJECT_HOME = 'https://github.com/imaro0523-byte/imaro0523-byte.github.io';

export function hasFeedbackForm(): boolean {
  return FEEDBACK_FORM.trim() !== '';
}
