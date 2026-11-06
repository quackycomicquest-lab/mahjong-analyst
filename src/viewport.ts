/**
 * 画面の向きの扱い（iPhone は横画面で使う）
 *
 * - 横向きで高さが 540px 以下（横持ちの iPhone）：html に phone-land を付け、横画面用の配置にする
 * - 縦向きで幅が 540px 以下のタッチ端末（縦持ちの iPhone）：phone-land と phone-rotated を付け、
 *   アプリ全体を CSS で90度回して横画面にする。iOS はウェブアプリの画面の向きを固定できないので、
 *   画面の向きのロック中でも、開いた時から横画面で使えるようにこうしている
 * CSS の --app-w / --app-h は、アプリから見た画面の幅・高さ（回すときは入れ替わる）。--vp-w は実際の画面の幅。
 *
 * 回しているときの縦スクロールは自前で行う（指の動きを、回した画面の縦方向に直してスクロールする）。
 * 回した要素の中のスクロールの向きはブラウザによって扱いが違うため、どの端末でも同じ動きにする。
 */
const PHONE_SHORT_SIDE = 540

export function setupViewport(): void {
  if (typeof window === 'undefined') return
  const html = document.documentElement
  const coarse = window.matchMedia?.('(pointer: coarse)')

  const update = () => {
    const w = window.innerWidth
    const h = window.innerHeight
    const landPhone = w > h && h <= PHONE_SHORT_SIDE
    const rotate = h > w && w <= PHONE_SHORT_SIDE && !!coarse?.matches
    html.classList.toggle('phone-land', landPhone || rotate)
    html.classList.toggle('phone-rotated', rotate)
    html.style.setProperty('--app-w', `${rotate ? h : w}px`)
    html.style.setProperty('--app-h', `${rotate ? w : h}px`)
    html.style.setProperty('--vp-w', `${w}px`)
  }

  update()
  window.addEventListener('resize', update)
  window.addEventListener('orientationchange', () => setTimeout(update, 150))
  window.visualViewport?.addEventListener('resize', update)
  coarse?.addEventListener?.('change', update)
  installRotatedTouchScroll(html)
}

/** 縦にスクロールできる、いちばん近い親要素 */
function scrollableParent(el: Element | null): HTMLElement | null {
  for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
    if (!(e instanceof HTMLElement)) continue
    const oy = getComputedStyle(e).overflowY
    if ((oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight + 1) return e
  }
  return null
}

/**
 * 回した画面のスクロール。画面を右に90度回しているので、指を画面の右へ動かすと
 * 回した画面では上へ動かしたことになる（scrollTop を増やす）。離したあとは惰性で少し流れる。
 */
function installRotatedTouchScroll(html: HTMLElement): void {
  let target: HTMLElement | null = null
  let lastX = 0
  let lastT = 0
  let velocity = 0 // px/ms（scrollTop の増える向き）
  let moved = false
  let raf = 0

  window.addEventListener(
    'touchstart',
    (e) => {
      cancelAnimationFrame(raf)
      if (!html.classList.contains('phone-rotated') || e.touches.length !== 1) {
        target = null
        return
      }
      // 文字の入力欄はブラウザに任せる
      const t = e.target as Element
      if (t.closest('textarea, input, select')) {
        target = null
        return
      }
      target = scrollableParent(t)
      lastX = e.touches[0].clientX
      lastT = e.timeStamp
      velocity = 0
      moved = false
    },
    { passive: true },
  )

  window.addEventListener(
    'touchmove',
    (e) => {
      if (!target || e.touches.length !== 1) return
      // iOS は最初の touchmove で止めないと、ブラウザのスクロールが始まって止められなくなる
      e.preventDefault()
      const x = e.touches[0].clientX
      const dx = x - lastX
      if (!moved && Math.abs(dx) < 4) return
      moved = true
      target.scrollTop += dx
      const dt = Math.max(1, e.timeStamp - lastT)
      velocity = 0.8 * (dx / dt) + 0.2 * velocity
      lastX = x
      lastT = e.timeStamp
    },
    { passive: false },
  )

  window.addEventListener('touchend', () => {
    const el = target
    target = null
    if (!el || !moved) return
    let v = velocity
    let prev = performance.now()
    const step = (now: number) => {
      const dt = now - prev
      prev = now
      el.scrollTop += v * dt
      v *= Math.pow(0.995, dt)
      if (Math.abs(v) > 0.02) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
  })
}
