import { useState, useCallback, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import MetroMap from './components/MetroMap'

function useIsMobile() {
  const [m, setM] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 760px)')
    const fn = e => setM(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  return m
}

export default function App() {
  const isMobile = useIsMobile()
  const [selected, setSelected] = useState(null)
  const [meta, setMeta] = useState({ stats: [], names: [] })
  const [origin, setOrigin] = useState('')
  const [dest, setDest] = useState('')
  const [route, setRoute] = useState(null)
  const [open, setOpen] = useState(false)

  const onMeta = useCallback((m) => setMeta(m), [])
  const onRoute = useCallback((r) => setRoute(r), [])

  useEffect(() => { if (isMobile && route) setOpen(true) }, [route, isMobile])

  const sel = {
    width: '100%', marginTop: 6, padding: '10px 12px', borderRadius: 8,
    background: '#0a0e14', color: '#e0f7ff', border: '1px solid #1f3a44', fontSize: 15,
  }

  const Panel = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#66ffff', marginBottom: 4 }}>Buscar ruta</div>
      <select value={origin} onChange={e => setOrigin(e.target.value)} style={sel}>
        <option value="">Origen…</option>
        {meta.names.map(n => <option key={n} value={n}>{n}</option>)}
      </select>
      <select value={dest} onChange={e => setDest(e.target.value)} style={sel}>
        <option value="">Destino…</option>
        {meta.names.map(n => <option key={n} value={n}>{n}</option>)}
      </select>

      {route && (
        <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>~{route.minutes} min · {route.dist}</div>
          {route.steps.map((s, i) => (
            <div key={i}>
              {i > 0 && <div style={{ color: '#66ffff', margin: '4px 0' }}>↕ Transbordo en {s.from}</div>}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 11, height: 11, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                <span>L{s.ref}: {s.from} → {s.to} <span style={{ color: '#5f7b8a' }}>({s.count} est.)</span></span>
              </div>
            </div>
          ))}
          <div onClick={() => { setOrigin(''); setDest('') }}
            style={{ marginTop: 8, color: '#66ffff', cursor: 'pointer', textAlign: 'center' }}>✕ limpiar ruta</div>
        </div>
      )}

      <div style={{ fontSize: 13, fontWeight: 600, color: '#66ffff', margin: '18px 0 6px' }}>Líneas</div>
      {meta.stats.map(s => {
        const isSel = selected === s.ref
        return (
          <div key={s.ref}
            onClick={() => { setSelected(isSel ? null : s.ref); if (isMobile) setOpen(false) }}
            style={{
              padding: '10px 12px', marginBottom: 5, borderRadius: 8, cursor: 'pointer',
              background: isSel ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.02)',
              borderLeft: `4px solid ${s.color}`,
            }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 15 }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: s.color }} /> Línea {s.ref}
            </div>
            {isSel && <div style={{ fontSize: 13, color: '#9fb8c8', lineHeight: 1.7, paddingLeft: 20, marginTop: 5 }}>
              {s.count} estaciones<br />{s.dist} de recorrido<br />~{s.time} min</div>}
          </div>
        )
      })}
    </div>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <Canvas camera={{ position: [0, 90, 90], fov: 50 }} style={{ background: '#0a0e14', position: 'absolute', inset: 0 }}>
        <ambientLight intensity={0.8} />
        <directionalLight position={[50, 100, 50]} intensity={1} />
        <MetroMap url="/data/metro.geojson" selected={selected} origin={origin} dest={dest} onMeta={onMeta} onRoute={onRoute} />
        <OrbitControls enableDamping enablePan screenSpacePanning panSpeed={1.5} />
      </Canvas>

      {!isMobile && (
        <aside style={{
          position: 'absolute', top: 0, left: 0, bottom: 0, width: 280,
          background: '#0d1219', borderRight: '1px solid #1f3a44', color: '#e0f7ff',
          fontFamily: 'system-ui, sans-serif', padding: 16, overflowY: 'auto',
        }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 14 }}>Metro CDMX</div>
          {Panel}
        </aside>
      )}

      {isMobile && (
        <>
          {!open && (
            <button onClick={() => setOpen(true)} style={{
              position: 'absolute', bottom: 'calc(16px + env(safe-area-inset-bottom))', left: '50%',
              transform: 'translateX(-50%)', padding: '12px 22px', borderRadius: 30, border: 'none',
              background: '#1f6b6b', color: '#e0f7ff', fontSize: 15, fontWeight: 600, fontFamily: 'system-ui',
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}>
              {route ? `Ruta ~${route.minutes} min` : '🔍 Buscar ruta'}
            </button>
          )}

          <div style={{
            position: 'absolute', left: 0, right: 0, bottom: 0,
            maxHeight: '70vh', transform: open ? 'translateY(0)' : 'translateY(100%)',
            transition: 'transform 0.28s ease', background: '#0d1219',
            borderTop: '1px solid #1f3a44', borderRadius: '16px 16px 0 0',
            color: '#e0f7ff', fontFamily: 'system-ui, sans-serif',
            padding: '8px 16px calc(20px + env(safe-area-inset-bottom))', overflowY: 'auto',
            boxShadow: '0 -6px 24px rgba(0,0,0,0.5)',
          }}>
            <div onClick={() => setOpen(false)} style={{
              width: 44, height: 5, borderRadius: 3, background: '#3a5560',
              margin: '6px auto 14px', cursor: 'pointer',
            }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 17, fontWeight: 700 }}>Metro CDMX</div>
              <div onClick={() => setOpen(false)} style={{ fontSize: 20, color: '#66ffff', cursor: 'pointer', padding: 4 }}>✕</div>
            </div>
            {Panel}
          </div>
        </>
      )}
    </div>
  )
}