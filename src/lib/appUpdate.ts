/**
 * appUpdate.ts — 새 버전 배포 후 남아 있는 옛 탭 처리
 *
 * 배경(2026-09-29 실사용 리포트):
 *   CMS 증빙 대사 화면에서 빨간 영문 오류
 *     Failed to fetch dynamically imported module:
 *     https://treasury.selvas.com/assets/pdf-D7TLTprI.js
 *   실측 결과 그 파일은 **404**(GitHub Pages 가 404.html 을 text/html 로 반환)였다.
 *
 *   원인은 PDF 뷰어가 아니라 배포 방식이다. Vite 는 청크 파일명에 내용 해시를 붙이고
 *   배포 시 옛 파일을 지운다. 그런데 SPA 는 한 번 연 탭을 며칠씩 켜 두므로,
 *   **배포 전에 로드된 탭**이 그 뒤에 처음 여는 화면(동적 import)에서 이미 사라진
 *   청크를 요청한다 → 404 → import 실패. 새로고침하면 해결되지만, 사용자에게는
 *   "CMS 증빙이 오류난다"로 보인다.
 *
 * ⚠ 자동 새로고침은 하지 않는다 — 자금일보 작성 중 입력이 날아갈 수 있다.
 *   사용자가 직접 누르는 안내 배너만 띄운다.
 */

const BANNER_ID = 'app-update-banner'

/** 청크 로드 실패(= 배포된 파일이 사라짐) 인가 */
export function isChunkLoadError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '')
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError/i.test(msg)
}

/** 사용자에게 보여줄 안내 문구 — 영문 원문 대신 이것을 쓴다 */
export const UPDATE_MESSAGE =
  '새 버전이 배포되어 이 기능의 코드를 불러오지 못했습니다. 페이지를 새로고침하면 해결됩니다.'

/** 화면 하단에 새로고침 안내 배너 표시 (중복 생성 안 함) */
export function showUpdateBanner(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(BANNER_ID)) return

  const bar = document.createElement('div')
  bar.id = BANNER_ID
  bar.setAttribute('role', 'alert')
  bar.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:24px', 'transform:translateX(-50%)',
    'z-index:2147483647', 'display:flex', 'align-items:center', 'gap:12px',
    'max-width:calc(100vw - 32px)', 'padding:12px 16px', 'border-radius:10px',
    'background:#1e293b', 'color:#f1f5f9', 'font-size:13px', 'line-height:1.5',
    'box-shadow:0 8px 24px rgba(0,0,0,.35)',
  ].join(';')

  const text = document.createElement('span')
  text.textContent = UPDATE_MESSAGE
  text.style.cssText = 'flex:1'

  const reload = document.createElement('button')
  reload.type = 'button'
  reload.textContent = '새로고침'
  reload.style.cssText =
    'flex:none;padding:6px 12px;border:0;border-radius:6px;background:#2563eb;color:#fff;font-size:13px;cursor:pointer'
  reload.onclick = () => window.location.reload()

  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = '✕'
  close.setAttribute('aria-label', '닫기')
  close.style.cssText =
    'flex:none;padding:4px 6px;border:0;border-radius:6px;background:transparent;color:#94a3b8;font-size:13px;cursor:pointer'
  close.onclick = () => bar.remove()

  bar.append(text, reload, close)
  document.body.appendChild(bar)
}

/**
 * 전역 청크 오류 감지 설치 (main.tsx 에서 1회 호출)
 *
 * Vite 는 동적 import/preload 실패 시 `vite:preloadError` 를 발생시킨다.
 * preventDefault() 해야 Vite 기본 동작(오류 전파)이 멈춘다.
 * 라우트 전환처럼 코드에 catch 가 없는 경로도 이 핸들러가 받는다.
 */
export function installChunkErrorHandler(): void {
  if (typeof window === 'undefined') return

  window.addEventListener('vite:preloadError', (e) => {
    e.preventDefault()
    showUpdateBanner()
  })

  // 동적 import 를 직접 await 하다 잡히지 않은 경우(핸들러 없는 Promise)도 받는다.
  window.addEventListener('unhandledrejection', (e) => {
    if (isChunkLoadError(e.reason)) showUpdateBanner()
  })
}
