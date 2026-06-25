/**
 * SELVAS TREASURY 설명회 스크린샷 자동 캡처
 * 실행: node scripts/capture-screenshots.mjs
 */
import { chromium } from 'playwright'
import path from 'path'
import fs from 'fs'

const BASE_URL = 'http://localhost:5175/New-Treasury'
const OUT_DIR  = path.resolve('docs/screenshots')
const EMAIL    = 'admin@selvas.com'
const PASSWORD = 'wjddustn11@'

const PAGES = [
  {
    file: '01_login',
    desc: '로그인 화면',
    before: async (page) => {
      await page.goto(`${BASE_URL}/login`)
      await page.waitForLoadState('networkidle')
    },
    scroll: 0,
  },
  {
    file: '02_dashboard',
    desc: '통합 상황판',
    url: '/dashboard/셀바스에이아이',
    scroll: 0,
  },
  {
    file: '03_input_opCash',
    desc: '운전자금 입력',
    url: '/input/셀바스에이아이',
    scroll: 0,
  },
  {
    file: '04_invest_table',
    desc: '운용자금 (메디아나)',
    url: '/invest/메디아나',
    scroll: 0,
  },
  {
    file: '05_loans_table',
    desc: '차입금 (셀바스에이아이)',
    url: '/loans/셀바스에이아이',
    scroll: 0,
  },
  {
    file: '06_equity',
    desc: '지분/장기투자',
    url: '/equity/셀바스에이아이',
    scroll: 0,
  },
  {
    file: '07_daily_summary',
    desc: '자금일보 자금현황',
    url: '/daily-report/셀바스에이아이/2026-06-24',
    scroll: 0,
  },
  {
    file: '08_daily_items',
    desc: '자금일보 입출금+검증',
    url: '/daily-report/셀바스에이아이/2026-06-24',
    scroll: 900,
  },
  {
    file: '09_daily_list',
    desc: '일별 자금일보 목록',
    url: '/daily-report-list/셀바스에이아이',
    scroll: 0,
  },
  {
    file: '10_policy_meeting',
    desc: '자금정책 회의·의결',
    url: '/policy/셀바스에이아이',
    tab: '회의·의결',
    scroll: 0,
  },
  {
    file: '11_policy_fx',
    desc: '자금정책 FX 정책',
    url: '/policy/셀바스에이아이',
    tab: 'FX 정책',
    scroll: 0,
  },
  {
    file: '12_admin_users',
    desc: '사용자 관리',
    url: '/admin/users',
    scroll: 0,
  },
  {
    file: '13_admin_orgchart',
    desc: '조직도/결재선 관리',
    url: '/admin/org-chart',
    scroll: 0,
  },
]

fs.mkdirSync(OUT_DIR, { recursive: true })

async function wait(ms) {
  return new Promise(r => setTimeout(r, ms))
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  // ── STEP 1: 로그인 화면 캡처 (로그인 전)
  console.log('📸 로그인 화면 캡처 중...')
  await page.goto(`${BASE_URL}/login`)
  await page.waitForLoadState('networkidle')
  await wait(1000)
  await page.screenshot({ path: path.join(OUT_DIR, '01_login.png') })
  console.log('  ✅ 01_login.png')

  // ── STEP 2: 로그인
  console.log('\n🔑 로그인 시도 중...')
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  // 정확히 "로그인" 텍스트인 버튼만 클릭 (이메일 로그인 탭 버튼 제외)
  await page.getByRole('button', { name: '로그인', exact: true }).click()

  // 로그인 완료 대기 — /login 에서 벗어날 때까지
  try {
    await page.waitForURL(url => !url.href.includes('/login'), { timeout: 20000 })
    await page.waitForLoadState('networkidle')
    await wait(2500)
    console.log(`  ✅ 로그인 성공: ${page.url()}`)
  } catch {
    const errText = await page.locator('text=올바르지').textContent().catch(() => '')
    const curUrl  = page.url()
    console.error('  ❌ 로그인 실패:', errText || `현재 URL: ${curUrl}`)
    await browser.close()
    process.exit(1)
  }

  // ── STEP 3: 각 페이지 캡처
  console.log('\n📸 페이지 캡처 시작...')
  for (const p of PAGES.slice(1)) {
    try {
      await page.goto(`${BASE_URL}${p.url}`)
      await page.waitForLoadState('networkidle')
      await wait(2000)

      // 도움말 패널 닫기 (뷰포트 밖일 수 있으므로 JS로 강제 실행)
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')]
          .find(b => b.textContent.trim() === '✕')
        if (btn) btn.click()
      })
      await wait(300)

      // 탭 클릭
      if (p.tab) {
        const tabBtn = page.locator(`button:has-text("${p.tab}")`)
        if (await tabBtn.count() > 0) {
          await tabBtn.first().click()
          await wait(1500)
        }
      }

      // 스크롤
      if (p.scroll > 0) {
        await page.evaluate((s) => {
          const scrollables = [...document.querySelectorAll('*')]
            .filter(el => el.scrollHeight > el.clientHeight + 10 && el.clientHeight > 100)
          scrollables.forEach(el => (el.scrollTop = s))
        }, p.scroll)
        await wait(800)
      }

      await page.screenshot({ path: path.join(OUT_DIR, `${p.file}.png`) })
      console.log(`  ✅ ${p.file}.png  — ${p.desc}`)
    } catch (err) {
      console.error(`  ❌ ${p.file} 실패:`, err.message)
    }
  }

  await browser.close()

  // ── 결과 요약
  const files = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.png'))
  console.log(`\n🎉 완료! ${files.length}장 저장됨`)
  console.log(`📁 저장 위치: ${OUT_DIR}`)
  files.forEach(f => console.log(`   • ${f}`))
})()
