export const pageChecks = () => {
  const W = innerWidth, issues = []
  if (document.documentElement.scrollWidth > W + 1) issues.push(`horizontal overflow: page is ${document.documentElement.scrollWidth}px wide in a ${W}px viewport`)
  // A nested scroller, or a clipping box that itself fits the viewport, excuses an element
  // past the edge. Clipping on html/body does not: that is what hides the bug.
  // Fixed elements escape their ancestors' clipping, so nothing excuses them.
  const scrollsX = el => {
    if (getComputedStyle(el).position === 'fixed') return false
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX
      const pr = p.getBoundingClientRect(), fits = pr.right <= W + 1 && pr.left >= -1
      if ((o === 'auto' || o === 'scroll') && fits) return true // a real scroller (chip rail, carousel)
      // Clipping excuses only a box narrower than the viewport: a viewport-sized
      // root with overflow hidden is exactly how a clipped Save button hides.
      if ((o === 'hidden' || o === 'clip') && fits && pr.width < W - 1) return true
    }
    return false
  }
  const past = []
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el)
    if (!r.width || cs.visibility === 'hidden' || cs.display === 'none') continue
    if (el.ownerSVGElement) continue // judge the <svg>, not each path inside it
    if ((r.right > W + 1 || r.left < -1) && !scrollsX(el)) past.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} [${Math.round(r.left)}..${Math.round(r.right)}]`)
  }
  if (past.length) issues.push(`${past.length} element(s) cross the viewport edge, e.g. ${past.slice(0, 4).join(', ')}`)
  for (const img of document.images) {
    const r = img.getBoundingClientRect(), cs = getComputedStyle(img)
    const raw = (img.currentSrc || img.src).split(/[?#]/)[0].split('/').pop()
    const name = (raw.length >= 16 && !/^[a-z]{1,12}(-([a-z]{1,12}|\d{1,4}))+(\.[a-z0-9]{2,5})?$/.test(raw) ? '[redacted]' : raw).slice(0, 60)
    if (!(img.currentSrc || img.src)) continue
    if (img.complete && !img.naturalWidth) { issues.push(`broken image: ${name}`); continue }
    if (!img.complete) { if (r.width && cs.display !== 'none') issues.push(`image never loaded: ${name}`); continue }
    if (!r.width || !r.height) continue
    const nat = img.naturalWidth / img.naturalHeight, box = r.width / r.height, off = Math.abs(box - nat) / nat
    if (cs.objectFit === 'fill' && off > 0.02) issues.push(`stretched image (${Math.round(off * 100)}% off, object-fit fill): ${name}`)
    if (cs.objectFit === 'contain' && off > 0.02) issues.push(`letterboxed image (object-fit contain, box ratio differs ${Math.round(off * 100)}%): ${name}`)
    const svg = /\.svg(\?|#|$)|^data:image\/svg\+xml/i.test(img.currentSrc || img.src)
    const shown = cs.objectFit === 'cover' ? Math.max(r.width, r.height * nat) : r.width
    if (!svg && shown > 48 && img.naturalWidth < shown * devicePixelRatio * 0.75) issues.push(`soft image (${img.naturalWidth}px source for ${Math.round(shown)}css px at ${devicePixelRatio}x): ${name}`)
  }
  return issues
}
