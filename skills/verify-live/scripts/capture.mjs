#!/usr/bin/env node
// capture.mjs: screenshot a page across engines x viewports x themes and run the
// checks a human misses on a fold shot. Exit 0 clean, 1 issues found, 2 setup error.
//
// Run from a directory where Playwright resolves (the project's e2e package, or any
// folder with `playwright` / `@playwright/test` installed):
//   node ~/.agents/skills/verify-live/scripts/capture.mjs --url https://host/path \
//     [--url ...] [--label home] [--out DIR] [--engines chromium,webkit]
//     [--themes light,dark] [--sizes 390x660,1440x900 | --sizes phones|tablets|desktop|all]
//     [--storage state.json] [--wait 1500] [--no-full]
//     [--theme-init "localStorage.setItem('theme', THEME)"]   (THEME -> 'light'|'dark';
//      needed when the app themes from storage/attributes, not only prefers-color-scheme)
// Checks: console/page errors, failed same-origin requests and failed scripts,
// styles and images from any origin (missing build assets), horizontal overflow
// and elements past the edge, broken, unloaded, stretched, letterboxed or soft
// images (after scrolling so lazy images load). Phones render at 3x, the rest at 2x.
// It cannot judge taste: a critic still reads every shot.
import {pageChecks} from './page-checks.mjs'
import {createRequire} from 'node:module'
import {mkdirSync, writeFileSync, existsSync, unlinkSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {join} from 'node:path'

const SETS = {
  phones: ['390x660', '412x660', '412x620', '360x640', '390x844', '430x932', '344x880'],
  tablets: ['755x1000', '744x1133', '820x1180', '1024x768'],
  desktop: ['1440x900'],
}
SETS.all = [...SETS.phones, ...SETS.tablets, ...SETS.desktop]

const args = {url: [], engines: 'chromium,webkit', themes: 'light,dark', sizes: 'all', wait: 1500, full: true}
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i], v = process.argv[i + 1]
  if (a === '--url') { args.url.push(v); i++ }
  else if (a === '--no-full') args.full = false
  else if (a.startsWith('--')) { args[a.slice(2)] = v; i++ }
}
if (!args.url.length) { console.error('usage: capture.mjs --url URL [--url ...] [options]; see header'); process.exit(2) }

let pw
for (const name of ['playwright', '@playwright/test']) {
  try { pw = createRequire(join(process.cwd(), 'noop.js'))(name); break } catch {}
}
if (!pw) { console.error('Playwright not resolvable from ' + process.cwd() + ': run from the project e2e folder'); process.exit(2) }

const sizes = (SETS[args.sizes] || args.sizes.split(',')).map(s => s.split('x').map(Number))
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const out = args.out || (existsSync('/Volumes/DevBox/tmp') ? `/Volumes/DevBox/tmp/verify/${stamp}` : `/tmp/verify/${stamp}`)
mkdirSync(out, {recursive: true})
const hasWebp = (() => { try { execFileSync('cwebp', ['-version'], {stdio: 'ignore'}); return true } catch { return false } })()

// Anything written to disk (names, reports) drops query strings and fragments:
// magic links, signed URLs and #access_token redirects must not land in evidence.
// Path segments that look like tokens (reset links, magic links) are masked too.
// Any segment of 16+ characters is masked unless it is a readable slug: short
// lowercase words and short numbers (how-to-plan-a-trip-2026). An opaque part
// (reset-password-8f3a2b1c9d7e, reset-abcdefghijklmnopq) is masked.
const READABLE = /^[a-z]{1,12}(-([a-z]{1,12}|\d{1,4}))+(\.[a-z0-9]{2,5})?$/
const maskPath = p => p.split('/').map(s => s.length >= 16 && !READABLE.test(s) ? '[redacted]' : s).join('/')
const clean = u => { try { const x = new URL(u); return x.origin + tokenRuns(maskPath(x.pathname)).replace(KEY_PATH, '[key path]') } catch { return '(unparsable url)' } }

function slug(u, i) {
  if (args.label) return args.url.length > 1 ? `${args.label}-${i + 1}` : args.label
  const p = new URL(u)
  const s = (p.host + tokenRuns(maskPath(p.pathname)).replace(KEY_PATH, 'x').replaceAll('[redacted]', 'x')).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60)
  return args.url.length > 1 ? `${i + 1}-${s}` : s
}
function save(png) {
  if (!hasWebp) return png
  const webp = png.replace(/\.png$/, '.webp')
  try { execFileSync('cwebp', ['-q', '80', png, '-o', webp], {stdio: 'ignore'}) } catch { try { unlinkSync(webp) } catch {} return png } // WebP caps at 16383px
  unlinkSync(png); return webp
}


// Last line of defence: every issue string is scrubbed of token-like runs
// (image names, element ids, messages) before it is written anywhere.
const KEY_PATH = /[\w.~\/-]*(?:(?:^|\/)\.?(?:ssh|private_keys|gnupg|keychains?)\/[\w.\/-]*|\.(?:pem|p8|p12|pfx|key|keystore|jks|der|bks|ppk)\b)/gi
const tokenRuns = t => t.replace(/[A-Za-z0-9_\-+\/=.]{16,}/g, m => {
  const parts = m.split('/')
  const tokenish = x => (/\d/.test(x) && /[A-Za-z]/.test(x)) || x.length >= 32 || (/[A-Z]/.test(x) && /[a-z]/.test(x) && x.length >= 20)
  // A run with a readable slug part is a path: judge each part. Otherwise it
  // is one opaque run (a base64 key split by '/', say): judge it whole.
  if (parts.some(x => x.length >= 4 && READABLE.test(x))) return parts.map(x => x.length >= 16 && !READABLE.test(x) && tokenish(x) ? '[redacted]' : x).join('/')
  return tokenish(m.replace(/[\/=+.]/g, '')) ? '[redacted]' : m
})
const scrubAll = t => tokenRuns(t
  .replace(/https?:\/\/[^\s'")]+/g, m => clean(m))
  .replace(/\b(Bearer|Basic|Token|Digest)\s+[^\s"',;]+/gi, '$1 [redacted]')
  .replace(/\b([\w.-]*(?:token|secret|passw(?:or)?d|key|session|auth|cookie)[\w.-]*)(["']?\s*[:=]\s*["']?)[^\s"'&,;]{6,}/gi, '$1$2[redacted]')
  .replace(KEY_PATH, '[key path]'))

const report = []
for (const engine of args.engines.split(',')) {
  const browser = await pw[engine].launch()
  for (const [w, h] of sizes) for (const theme of args.themes.split(',')) {
    const mobile = w < 1024
    const ctx = await browser.newContext({
      viewport: {width: w, height: h}, deviceScaleFactor: w < 600 ? 3 : 2, colorScheme: theme,
      ...(mobile && engine !== 'firefox' ? {isMobile: true, hasTouch: true} : {}),
      ...(args.storage ? {storageState: args.storage} : {}),
    })
    if (args['theme-init']) await ctx.addInitScript(`try { ${args['theme-init'].replaceAll('THEME', JSON.stringify(theme))} } catch {}`)
    for (const [i, url] of args.url.entries()) {
      const page = await ctx.newPage(), issues = [], origin = new URL(url).origin
      page.on('console', m => m.type() === 'error' && issues.push(`console error: ${scrub(m.text())}`))
      page.on('pageerror', e => issues.push(`page error: ${scrub(String(e))}`))
      const mine = u => { try { return new URL(u).origin === origin } catch { return false } }
      const asset = req => ['script', 'stylesheet', 'image', 'font'].includes(req.resourceType())
      // Reports never carry query strings or long tokens (signed URLs, session ids).
      const short = u => { try { const x = new URL(u); return (mine(u) ? '' : x.origin) + maskPath(x.pathname).slice(0, 120) } catch { return '(unparsable url)' } }
      const scrub = t => scrubAll(t.replace(/https?:\/\/[^\s'")]+/g, m => short(m))).slice(0, 160) // scrub first, then cut
      page.on('response', r => { if (r.status() >= 400 && (mine(r.url()) || asset(r.request()))) issues.push(`HTTP ${r.status()}: ${short(r.url())}`) })
      page.on('requestfailed', r => (mine(r.url()) || asset(r)) && issues.push(`request failed: ${short(r.url())}`))
      const base = join(out, `${slug(url, i)}-${w}x${h}-${engine}-${theme}`)
      try {
        // 'load', not 'networkidle': apps with websockets, SSE or polling never go idle.
        await page.goto(url, {waitUntil: 'load', timeout: 45_000})
        await page.waitForLoadState('networkidle', {timeout: 5_000}).catch(() => {})
        await page.waitForTimeout(Number(args.wait))
        // Scroll through so lazy images load, then return to the top for the shot.
        await page.evaluate(async () => {
          for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight * 0.8) { scrollTo(0, y); await new Promise(r => setTimeout(r, 150)) }
          scrollTo(0, 0)
        })
        await page.waitForTimeout(600)
        issues.push(...await page.evaluate(pageChecks))
        const shots = [save(await page.screenshot({path: base + '.png'}).then(() => base + '.png'))]
        if (args.full) shots.push(save(await page.screenshot({path: base + '-full.png', fullPage: true}).then(() => base + '-full.png')))
        report.push({url: clean(url), engine, theme, size: `${w}x${h}`, shots, issues: [...new Set(issues.map(scrubAll))]})
      } catch (e) {
        report.push({url: clean(url), engine, theme, size: `${w}x${h}`, shots: [], issues: [...new Set([...issues, `load failed: ${scrub(String(e))}`].map(scrubAll))]})
      }
      await page.close()
    }
    await ctx.close()
  }
  await browser.close()
}

const bad = report.filter(r => r.issues.length)
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
writeFileSync(join(out, 'report.md'), [`# Capture report: ${bad.length} of ${report.length} views with issues`, '',
  ...report.map(r => `- ${r.issues.length ? 'ISSUES' : 'ok'} ${r.engine} ${r.theme} ${r.size} ${r.url}${r.issues.map(x => `\n  - ${x}`).join('')}`)].join('\n') + '\n')
console.log(`capture: ${report.length} views, ${bad.length} with issues -> ${out}/report.md`)
process.exit(bad.length ? 1 : 0)
