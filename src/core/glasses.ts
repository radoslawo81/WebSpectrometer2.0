// Sunglasses / lens tester (web-only): relative transmission measured with the sensor board
// (AS7331 UVA/UVB/UVC + AS7265x 18 channels). For each light source the user records a reference
// (no lens) and then the lens; tau = lens / reference per channel.
//
// Sources: single-wavelength LEDs (the illuminator: 255, 365, 380, 390, 400, 410, 420 nm) give one
// point of the transmission curve each; a broadband source (white lamp / sunlight) gives the luminous
// transmittance tau_v (filter category), blue light (HEV), IR and - if it contains UV - UVA/UVB.
import { CIE_WL_START, CIE_WL_STEP, YBAR } from './cieData'

export interface GlassesSource {
  id: string
  nm: number | null // LED peak, null = broadband
  label: string
  uvc?: boolean
}

export const GLASSES_SOURCES: GlassesSource[] = [
  { id: '255', nm: 255, label: '255 nm', uvc: true },
  { id: '365', nm: 365, label: '365 nm' },
  { id: '380', nm: 380, label: '380 nm' },
  { id: '390', nm: 390, label: '390 nm' },
  { id: '400', nm: 400, label: '400 nm' },
  { id: '410', nm: 410, label: '410 nm' },
  { id: '420', nm: 420, label: '420 nm' },
  { id: 'white', nm: null, label: 'white' },
  { id: 'sun', nm: null, label: 'sun' },
]

/** One averaged reading of both sensors: [UVA, UVB, UVC] and the 18 triad channels (µW/cm²) */
export interface SensorSnapshot {
  uv: number[] | null // [uva, uvb, uvc]
  tri: number[] | null
  triNm: number[] | null
}

// Noise floors (µW/cm²) below which a reference channel is not used
const UV_FLOOR = 0.05
const TRI_FLOOR = 0.5
const MIN_REF_FRACTION = 0.1 // a channel counts if its reference is >= 10 % of the strongest of its sensor

export interface LedResult {
  tau: number | null // 0..1, null = not enough signal
  channels: string[] // channels used
  weak: boolean // reference too weak
}

/** Transmission at one LED: weighted mean of tau over the channels that see the LED in the reference */
export function ledTransmission(ref: SensorSnapshot, lens: SensorSnapshot): LedResult {
  let num = 0
  let den = 0
  const used: string[] = []
  const uvNames = ['UVA', 'UVB', 'UVC']
  const take = (r: number[] | null, l: number[] | null, floor: number, name: (i: number) => string) => {
    if (!r || !l) return
    const max = Math.max(...r)
    if (!(max > floor)) return
    r.forEach((rv, i) => {
      if (rv > floor && rv >= MIN_REF_FRACTION * max) {
        num += Math.max(0, l[i])
        den += rv
        used.push(name(i))
      }
    })
  }
  take(ref.uv, lens.uv, UV_FLOOR, (i) => uvNames[i])
  take(ref.tri, lens.tri, TRI_FLOOR, (i) => `${ref.triNm?.[i] ?? ''} nm`)
  if (den <= 0) return { tau: null, channels: [], weak: true }
  return { tau: Math.min(1.5, num / den), channels: used, weak: false }
}

const vLambda = (nm: number) => {
  const x = (nm - CIE_WL_START) / CIE_WL_STEP
  if (x < 0 || x > YBAR.length - 1) return 0
  const i = Math.floor(x)
  const f = x - i
  return YBAR[i] * (1 - f) + (YBAR[Math.min(i + 1, YBAR.length - 1)] ?? 0) * f
}

export interface BroadResult {
  tauV: number | null // luminous transmittance (V(lambda) weighted, with the source's own spectrum)
  category: number | null // 0..4, 5 = darker than category 4
  hev: number | null // 410-460 nm
  ir: number | null // 860-940 nm
  uva: number | null
  uvb: number | null
}

function ratio(ref: number[], lens: number[], w: number[]): number | null {
  let n = 0
  let d = 0
  ref.forEach((r, i) => {
    if (w[i] > 0 && r > TRI_FLOOR) {
      n += w[i] * Math.max(0, lens[i])
      d += w[i] * r
    }
  })
  return d > 0 ? n / d : null
}

export function filterCategory(tauV: number): number {
  if (tauV > 0.8) return 0
  if (tauV > 0.43) return 1
  if (tauV > 0.18) return 2
  if (tauV > 0.08) return 3
  if (tauV > 0.03) return 4
  return 5
}

export function broadbandTransmission(ref: SensorSnapshot, lens: SensorSnapshot): BroadResult {
  const out: BroadResult = { tauV: null, category: null, hev: null, ir: null, uva: null, uvb: null }
  if (ref.tri && lens.tri && ref.triNm) {
    const nm = ref.triNm
    out.tauV = ratio(ref.tri, lens.tri, nm.map(vLambda))
    out.hev = ratio(ref.tri, lens.tri, nm.map((w) => (w >= 405 && w <= 465 ? 1 : 0)))
    out.ir = ratio(ref.tri, lens.tri, nm.map((w) => (w >= 850 ? 1 : 0)))
    if (out.tauV != null) out.category = filterCategory(out.tauV)
  }
  if (ref.uv && lens.uv) {
    if (ref.uv[0] > UV_FLOOR * 10) out.uva = Math.max(0, lens.uv[0]) / ref.uv[0]
    if (ref.uv[1] > UV_FLOOR * 10) out.uvb = Math.max(0, lens.uv[1]) / ref.uv[1]
  }
  return out
}

export type UvVerdict = 'none' | 'uv400' | 'good' | 'weak' | 'harmful'

/** Overall UV verdict from the LED points <= 400 nm and the broadband UVA/UVB */
export function uvVerdict(ledTau: Record<string, number | null>, broad: BroadResult | null): { verdict: UvVerdict; maxUv: number | null } {
  const uvPoints: number[] = []
  for (const s of GLASSES_SOURCES) {
    if (s.nm != null && s.nm >= 300 && s.nm <= 400) {
      const v = ledTau[s.id]
      if (v != null) uvPoints.push(v)
    }
  }
  if (broad?.uva != null) uvPoints.push(broad.uva)
  if (broad?.uvb != null) uvPoints.push(broad.uvb)
  if (!uvPoints.length) return { verdict: 'none', maxUv: null }
  const maxUv = Math.max(...uvPoints)
  const tauV = broad?.tauV ?? null
  if (tauV != null && maxUv > tauV && maxUv > 0.05) return { verdict: 'harmful', maxUv }
  if (maxUv <= 0.01 && ledTau['400'] != null) return { verdict: 'uv400', maxUv }
  if (maxUv <= 0.05) return { verdict: 'good', maxUv }
  return { verdict: 'weak', maxUv }
}
