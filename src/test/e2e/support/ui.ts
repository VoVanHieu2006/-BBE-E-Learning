import { expect, type Page } from '@playwright/test'
import { ACCOUNTS, SEED_PASSWORD, type AccountKey } from './seed'

export const HOME: Record<string, RegExp> = {
  admin: /\/admin\/dashboard/, chapterLead: /\/chapter-manager\/dashboard/, dnaLead: /\/organization-manager/, member: /\/student\/dashboard/,
}

/** Signs in through the real login form, exactly as a person does. */
export async function signIn(page: Page, email: string, password: string = SEED_PASSWORD) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: /Đăng nhập vào hệ thống/ }).click()
}

export async function signInAs(page: Page, account: AccountKey) {
  await signIn(page, ACCOUNTS[account])
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
}

/**
 * Only YouTube itself is replaced: a player whose clock advances in real time while "playing", so the real
 * component, the real heartbeats and the real server-side anti-cheat all run. `window.__yt` drives it like a viewer.
 */
export async function fakeYouTube(page: Page) {
  await page.route(/youtube\.com\/iframe_api/, (route) => route.fulfill({ contentType: 'text/javascript', body: '' }))
  await page.route(/(i\.ytimg\.com|img\.youtube\.com)\//, (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' }))
  await page.addInitScript(() => {
    const win = window as any
    win.__yt = { players: [] as any[], get current() { return this.players[this.players.length - 1] } }
    win.YT = {
      PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
      Player: class {
        time = 0; rate = 1; state = -1; duration = 0; anchor = 0; frame: HTMLIFrameElement; timer: any
        constructor(element: HTMLElement, private options: any) {
          win.__yt.players.push(this)
          this.frame = document.createElement('iframe')
          this.frame.title = 'Video bài học (YouTube giả lập cho E2E)'
          this.frame.style.cssText = 'width:100%;height:100%;border:0;display:block'
          this.frame.srcdoc = '<body style="margin:0;background:#101b32"></body>'
          element.replaceWith(this.frame)
          this.duration = Number(win.__ytDuration || 0)
          setTimeout(() => options.events?.onReady?.({ target: this }), 0)
          this.timer = setInterval(() => {
            if (this.state !== 1) return
            const now = performance.now()
            this.time = Math.min(this.duration || Infinity, this.time + ((now - this.anchor) / 1000) * this.rate)
            this.anchor = now
            if (this.duration && this.time >= this.duration) this.emit(0)
          }, 100)
        }
        emit(state: number) { this.state = state; this.options.events?.onStateChange?.({ data: state, target: this }) }
        playVideo() { this.anchor = performance.now(); this.emit(1) }
        pauseVideo() { this.emit(2) }
        stopVideo() { this.state = 2 }
        seekTo(time: number) { this.time = time; this.anchor = performance.now() }
        setPlaybackRate(rate: number) { this.rate = rate; this.options.events?.onPlaybackRateChange?.({ data: rate, target: this }) }
        getPlaybackRate() { return this.rate }
        getAvailablePlaybackRates() { return [0.5, 1, 1.5, 2] }
        getCurrentTime() { return this.time }
        getDuration() { return this.duration || 600 }
        getPlayerState() { return this.state }
        getVideoData() { return { title: 'E2E' } }
        getIframe() { return this.frame }
        mute() {} unMute() {} isMuted() { return false } setVolume() {} getVolume() { return 100 }
        unloadModule() {} loadModule() {} setOption() {} getOptions() { return [] }
        addEventListener() {} removeEventListener() {}
        destroy() { clearInterval(this.timer); this.frame.remove() }
      },
    }
  })
}

export type PageProblems = { console: string[]; failedRequests: string[] }
/** Collects what a user would experience as "something broke": uncaught errors, console errors, 5xx responses. */
export function watchProblems(page: Page): PageProblems {
  const problems: PageProblems = { console: [], failedRequests: [] }
  page.on('pageerror', (error) => problems.console.push(`pageerror: ${error.message.slice(0, 200)}`))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    // Expected refusals (401/403/404/409...) are logged by the browser itself; they are asserted where they matter.
    if (/Failed to load resource/.test(text)) return
    problems.console.push(text.slice(0, 200))
  })
  page.on('response', (response) => { if (response.status() >= 500 && !/\/api\/v1\/health/.test(response.url())) problems.failedRequests.push(`${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`) })
  return problems
}

export async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)
}
