import { ShieldIcon } from './Icons';

/**
 * The privacy statement, shown where a teacher is about to hand over a file.
 * It is deliberately specific rather than reassuring-sounding.
 */
export function PrivacyNotice({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="flex items-start gap-1.5 text-xs text-emerald-800 dark:text-emerald-300">
        <ShieldIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>이 파일은 서버로 전송되지 않으며 현재 브라우저에서만 처리됩니다.</span>
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950">
      <div className="flex items-start gap-2">
        <ShieldIcon className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-400" />
        <div className="space-y-1.5 text-sm">
          <p className="font-semibold text-emerald-900 dark:text-emerald-200">
            이 파일은 서버로 전송되지 않으며 현재 브라우저에서만 처리됩니다.
          </p>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-emerald-800 dark:text-emerald-300">
            <li>이 앱에는 서버도 데이터베이스도 없습니다. 엑셀 읽기와 자리 계산이 모두 이 컴퓨터 안에서 끝납니다.</li>
            <li>브라우저 보안 정책(CSP)으로 외부 주소와의 통신 자체를 막아 두었습니다.</li>
            <li>새로고침하면 학생 정보는 사라집니다. 저장은 설정에서 직접 켜고 버튼을 눌렀을 때만 이루어집니다.</li>
            <li>인터넷 연결을 끊고도 모든 기능이 그대로 동작합니다.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
