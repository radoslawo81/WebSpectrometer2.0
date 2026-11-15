// Sunglasses / lens tester tab of the Sensors window (web-only)
import { useMemo, useState } from 'react'
import { ToggleButton } from '../components/ToggleButton'
import { useT } from '../i18n'
import { downloadText } from '../core/files'
import { wavelengthToCss } from '../core/wavelengthColor'
import { useUv } from '../app/uvStore'
import {
  broadbandTransmission,
  GLASSES_SOURCES,
  ledTransmission,
  uvVerdict,
  type BroadResult,
  type SensorSnapshot,
  type UvVerdict,
} from '../core/glasses'

const AVG_N = 5

interface SavedPair {
  name: string
  time: string
  led: Record<string, number | null>
  broad: BroadResult | null
  verdict: UvVerdict
  maxUv: number | null
}

const pct = (v: number | null | undefined, digits = 1) => (v == null ? '—' : `${(v * 100).toFixed(v < 0.1 ? Math.max(digits, 2) : digits)} %`)

function Curve({ led }: { led: Record<string, number | null> }) {
  const W = 360
  const H = 150
  const L = 34
  const B = 20
  const x = (nm: number) => L + ((nm - 245) / (430 - 245)) * (W - L - 8)
  // log scale 0.1 % .. 100 %
  const y = (tau: number) => {
    const v = Math.log10(Math.max(tau * 100, 0.1))
    return 8 + ((2 - v) / 3) * (H - B - 8)
  }
  const pts = GLASSES_SOURCES.filter((s) => s.nm != null && led[s.id] != null).map((s) => ({ nm: s.nm as number, tau: led[s.id] as number }))
  return (
    <svg width={W} height={H} aria-label="transmission curve" style={{ background: '#fff', border: '1px solid var(--border, #ddd)', borderRadius: 6 }}>
      {[100, 10, 1, 0.1].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - 8} y1={y(v / 100)} y2={y(v / 100)} stroke={v === 1 ? '#e0a0a0' : '#eee'} strokeDasharray={v === 1 ? '4 3' : undefined} />
          <text x={L - 3} y={y(v / 100) + 3} fontSize={9} textAnchor="end" fill="#888">
            {v} %
          </text>
        </g>
      ))}
      <line x1={x(400)} x2={x(400)} y1={8} y2={H - B} stroke="#b07cd8" strokeDasharray="4 3" />
      <text x={x(400) + 3} y={18} fontSize={9} fill="#7e4cc2">
        UV400
      </text>
      {[250, 300, 350, 400].map((nm) => (
        <text key={nm} x={x(nm)} y={H - 6} fontSize={9} textAnchor="middle" fill="#666">
          {nm}
        </text>
      ))}
      {pts.length > 1 && <polyline points={pts.map((p) => `${x(p.nm)},${y(p.tau)}`).join(' ')} fill="none" stroke="#555" strokeWidth={1.2} />}
      {pts.map((p) => (
        <circle key={p.nm} cx={x(p.nm)} cy={y(p.tau)} r={4} fill={p.nm < 380 ? '#7e4cc2' : wavelengthToCss(p.nm)} stroke="#333" strokeWidth={0.5}>
          <title>{`${p.nm} nm: ${pct(p.tau, 2)}`}</title>
        </circle>
      ))}
    </svg>
  )
}

export function GlassesTester() {
  const t = useT()
  const uv = useUv()
  const [src, setSrc] = useState('365')
  const [refs, setRefs] = useState<Record<string, SensorSnapshot>>({})
  const [lens, setLens] = useState<Record<string, SensorSnapshot>>({})
  const [name, setName] = useState('')
  const [pairs, setPairs] = useState<SavedPair[]>([])
  const [msg, setMsg] = useState<string | null>(null)

  const snapshot = (): SensorSnapshot | null => {
    const now = Date.now()
    const u = uv.rows.filter((r) => now - r.t < 6000).slice(-AVG_N)
    const tr = uv.triadRows.filter((r) => now - r.t < 6000).slice(-AVG_N)
    if (!u.length && !tr.length) return null
    const avg = (rows: number[][]) => rows[0].map((_, i) => rows.reduce((a, r) => a + r[i], 0) / rows.length)
    return {
      uv: u.length ? avg(u.map((r) => [r.uva, r.uvb, r.uvc])) : null,
      tri: tr.length ? avg(tr.map((r) => r.values)) : null,
      triNm: tr.length ? tr[tr.length - 1].nm : null,
    }
  }

  const source = GLASSES_SOURCES.find((s) => s.id === src)!
  const srcLabel = (s: (typeof GLASSES_SOURCES)[number]) => (s.nm != null ? s.label : t(s.id === 'white' ? 'Gl_White' : 'Gl_Sun'))

  const captureRef = () => {
    const s = snapshot()
    if (!s) return setMsg(t('Gl_NoData'))
    setRefs({ ...refs, [src]: s })
    const l = { ...lens }
    delete l[src]
    setLens(l)
    setMsg(t('Gl_RefDone').replace('{s}', srcLabel(source)))
  }
  const captureLens = () => {
    if (!refs[src]) return setMsg(t('Gl_NeedRef'))
    const s = snapshot()
    if (!s) return setMsg(t('Gl_NoData'))
    setLens({ ...lens, [src]: s })
    setMsg(null)
  }

  const led = useMemo(() => {
    const out: Record<string, number | null> = {}
    const info: Record<string, { weak: boolean; ch: string[] }> = {}
    for (const s of GLASSES_SOURCES) {
      if (s.nm == null || !refs[s.id] || !lens[s.id]) continue
      const r = ledTransmission(refs[s.id], lens[s.id])
      out[s.id] = r.tau
      info[s.id] = { weak: r.weak, ch: r.channels }
    }
    return { tau: out, info }
  }, [refs, lens])

  const broad = useMemo(() => {
    for (const id of ['sun', 'white']) if (refs[id] && lens[id]) return broadbandTransmission(refs[id], lens[id])
    return null
  }, [refs, lens])
  const { verdict, maxUv } = uvVerdict(led.tau, broad)

  const verdictStyle: Record<UvVerdict, string> = { none: '#888', uv400: 'rgb(0,120,0)', good: 'rgb(0,120,0)', weak: 'rgb(190,90,0)', harmful: 'rgb(190,0,0)' }

  const savePair = () => {
    const p: SavedPair = { name: name || `${t('Gl_Pair')} ${pairs.length + 1}`, time: new Date().toLocaleString(), led: led.tau, broad, verdict, maxUv }
    setPairs([...pairs, p])
    setLens({})
    setName('')
    setMsg(t('Gl_Saved').replace('{n}', p.name))
  }

  const csv = () => {
    const ids = GLASSES_SOURCES.filter((s) => s.nm != null).map((s) => s.id)
    const head = ['name', 'time', ...ids.map((i) => `tau_${i}nm`), 'tau_v', 'category', 'HEV', 'IR', 'UVA_broad', 'UVB_broad', 'max_UV', 'verdict']
    const f = (v: number | null | undefined) => (v == null ? '' : v.toFixed(5))
    const rows = pairs.map((p) => [p.name, p.time, ...ids.map((i) => f(p.led[i])), f(p.broad?.tauV), p.broad?.category ?? '', f(p.broad?.hev), f(p.broad?.ir), f(p.broad?.uva), f(p.broad?.uvb), f(p.maxUv), p.verdict].join(';'))
    downloadText('okulary_test.csv', [head.join(';'), ...rows].join('\n'))
  }

  const refStrength = (id: string) => {
    const r = refs[id]
    if (!r) return '—'
    const parts: string[] = []
    if (r.uv) parts.push(`UV ${Math.max(...r.uv).toFixed(2)}`)
    if (r.tri) parts.push(`VIS ${Math.max(...r.tri).toFixed(1)}`)
    return parts.join(' · ')
  }

  const box = { border: '1px solid var(--border, #ddd)', borderRadius: 6, padding: 6, display: 'flex', flexDirection: 'column' as const, gap: 4 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('Gl_Help')}</div>
      <div className="field-row" style={{ gap: 4, flexWrap: 'wrap' }}>
        <span>{t('Gl_Source')}</span>
        {GLASSES_SOURCES.map((s) => (
          <ToggleButton key={s.id} active={src === s.id} onClick={() => setSrc(s.id)} title={s.uvc ? t('Gl_UvcWarn') : undefined}>
            {srcLabel(s)}
            {refs[s.id] ? (lens[s.id] ? ' ✓' : ' •') : ''}
          </ToggleButton>
        ))}
      </div>
      {source.uvc && <div style={{ fontSize: 11, color: 'rgb(190,0,0)', fontWeight: 600 }}>{t('Gl_UvcWarn')}</div>}
      <div className="field-row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <ToggleButton disabled={!uv.connected} onClick={captureRef}>
          {t('Gl_Ref')}
        </ToggleButton>
        <ToggleButton disabled={!uv.connected || !refs[src]} onClick={captureLens}>
          {t('Gl_Lens')}
        </ToggleButton>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {t('Gl_RefLevel')} {refStrength(src)}
        </span>
      </div>
      {msg && <div style={{ fontSize: 11 }}>{msg}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Curve led={led.tau} />
        <div style={{ ...box, flex: 1, minWidth: 300 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: verdictStyle[verdict] }}>{t(`Gl_V_${verdict}`).replace('{m}', pct(maxUv, 2))}</div>
          <table style={{ fontSize: 11, borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)' }}>
                <th style={{ textAlign: 'left' }}>{t('Gl_Source')}</th>
                <th style={{ textAlign: 'right' }}>τ</th>
                <th style={{ textAlign: 'right' }}>{t('Gl_Block')}</th>
              </tr>
            </thead>
            <tbody>
              {GLASSES_SOURCES.filter((s) => s.nm != null).map((s) => {
                const v = led.tau[s.id]
                const inf = led.info[s.id]
                return (
                  <tr key={s.id}>
                    <td>{s.label}</td>
                    <td style={{ textAlign: 'right' }} title={inf?.ch.join(', ')}>
                      {inf?.weak ? t('Gl_Weak') : pct(v, 2)}
                    </td>
                    <td style={{ textAlign: 'right' }}>{v == null ? '—' : pct(Math.max(0, 1 - v), 1)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {broad ? (
            <div style={{ fontSize: 11 }}>
              τv <b>{pct(broad.tauV)}</b> · {t('Gl_Cat')} <b>{broad.category == null ? '—' : broad.category > 4 ? t('Gl_TooDark') : broad.category}</b> · HEV {pct(broad.hev)} · IR {pct(broad.ir)}
              {broad.uva != null && <> · UVA {pct(broad.uva, 2)}</>}
              {broad.uvb != null && <> · UVB {pct(broad.uvb, 2)}</>}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('Gl_NoBroad')}</div>
          )}
        </div>
      </div>

      <div className="field-row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <input type="text" placeholder={t('Gl_PairName')} value={name} onChange={(e) => setName(e.target.value)} style={{ width: 180 }} />
        <ToggleButton disabled={!Object.keys(lens).length} onClick={savePair} title={t('Gl_SaveTip')}>
          {t('Gl_Save')}
        </ToggleButton>
        <ToggleButton disabled={!pairs.length} onClick={csv}>
          {t('Uv_SaveCsv')}
        </ToggleButton>
        <ToggleButton
          onClick={() => {
            setRefs({})
            setLens({})
            setMsg(null)
          }}
        >
          {t('Gl_Reset')}
        </ToggleButton>
      </div>
      {pairs.length > 0 && (
        <table style={{ fontSize: 11, borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)' }}>
              <th style={{ textAlign: 'left' }}>{t('Gl_Pair')}</th>
              <th style={{ textAlign: 'right' }}>max UV</th>
              <th style={{ textAlign: 'right' }}>400 nm</th>
              <th style={{ textAlign: 'right' }}>τv</th>
              <th style={{ textAlign: 'right' }}>{t('Gl_Cat')}</th>
              <th style={{ textAlign: 'left', paddingLeft: 8 }}>{t('Gl_Verdict')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pairs.map((p, i) => (
              <tr key={i}>
                <td>{p.name}</td>
                <td style={{ textAlign: 'right' }}>{pct(p.maxUv, 2)}</td>
                <td style={{ textAlign: 'right' }}>{pct(p.led['400'], 2)}</td>
                <td style={{ textAlign: 'right' }}>{pct(p.broad?.tauV)}</td>
                <td style={{ textAlign: 'right' }}>{p.broad?.category == null ? '—' : p.broad.category > 4 ? '>4' : p.broad.category}</td>
                <td style={{ paddingLeft: 8, color: verdictStyle[p.verdict] }}>{t(`Gl_V_${p.verdict}`).replace('{m}', pct(p.maxUv, 2))}</td>
                <td>
                  <button onClick={() => setPairs(pairs.filter((_, j) => j !== i))} title="×" style={{ border: 'none', background: 'none', cursor: 'pointer' }}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('Gl_Note')}</div>
    </div>
  )
}
