import { useEffect, useMemo, useState } from 'react'
import { Line, Billboard, Text } from '@react-three/drei'

const TRANSFER_MIN = 5
const CBB_TRANSFER_MIN = 6   // transbordo metro<->cable suele ser más largo

const SYSTEMS = [
  { key: 'METRO', label: 'Metro', est: '/data/metro_estaciones.geojson', lin: '/data/metro_lineas.geojson', yBase: 0,  order: ['1','2','3','4','5','6','7','8','9','A','B','12'] },
  { key: 'CBB',   label: 'Cablebús', est: '/data/cbb_estaciones.geojson', lin: '/data/cbb_lineas.geojson', yBase: 14, order: ['1','2','3'] },
]

function refNum(nombre = '') {
  const m = nombre.match(/L[íi]nea\s+L?([0-9AB]+)/i)
  return m ? m[1].toUpperCase() : ''
}
function comercialNum(nc = '') {
  return nc.toString().replace(/^L/i, '').toUpperCase()
}

const valid = (c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])

function haversine([lon1, lat1], [lon2, lat2]) {
  const R = 6371000, rad = d => d * Math.PI / 180
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function chainSegments(segs) {
  if (!segs.length) return []
  const used = new Array(segs.length).fill(false)
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2
  used[0] = true
  let poly = [...segs[0]]
  let added = true
  while (added) {
    added = false
    const head = poly[0], tail = poly[poly.length - 1]
    let best = -1, bestEnd = null, bestDist = Infinity, atTail = true
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue
      const s = segs[i], a = s[0], b = s[s.length - 1]
      const opts = [
        { dist: d2(tail, a), end: 'tail', rev: false },
        { dist: d2(tail, b), end: 'tail', rev: true },
        { dist: d2(head, a), end: 'head', rev: true },
        { dist: d2(head, b), end: 'head', rev: false },
      ]
      for (const o of opts) {
        if (o.dist < bestDist) { bestDist = o.dist; best = i; bestEnd = o; atTail = o.end === 'tail' }
      }
    }
    if (best === -1) break
    let s = segs[best]
    if (bestEnd.rev) s = [...s].reverse()
    used[best] = true
    if (atTail) poly = poly.concat(s.slice(1))
    else poly = s.slice(0, -1).concat(poly)
    added = true
  }
  return poly
}

function makeProjector(allCoords) {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity
  allCoords.forEach(([lon, lat]) => {
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon)
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat)
  })
  const cLon = (minLon + maxLon) / 2, cLat = (minLat + maxLat) / 2
  const k = Math.cos(cLat * Math.PI / 180)
  const w = (maxLon - minLon) * k, h = (maxLat - minLat)
  const scale = 120 / Math.max(w, h)
  return ([lon, lat]) => [(lon - cLon) * k * scale, -(lat - cLat) * scale]
}

const fmt = (m) => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`

export default function MetroMap({ selected, origin, dest, onMeta, onRoute }) {
  const [datasets, setDatasets] = useState(null)

  useEffect(() => {
    Promise.all(SYSTEMS.map(async sys => {
      const [est, lin] = await Promise.all([
        fetch(sys.est).then(r => r.json()),
        fetch(sys.lin).then(r => r.json()),
      ])
      return { sys, est, lin }
    })).then(setDatasets).catch(console.error)
  }, [])

  const built = useMemo(() => {
    if (!datasets) return null

    // proyector global con coords de TODOS los sistemas
    const allCoords = []
    datasets.forEach(({ lin, est }) => {
      lin.features.forEach(f => {
        if (f.geometry?.type === 'MultiLineString')
          f.geometry.coordinates.forEach(seg => seg.forEach(p => { if (valid(p)) allCoords.push(p) }))
      })
      est.features.forEach(f => { const c = f.geometry?.coordinates; if (valid(c)) allCoords.push(c) })
    })
    if (!allCoords.length) return null
    const project = makeProjector(allCoords)

    const lines = [], metaById = {}, polyById = {}, stations = []

    datasets.forEach(({ sys, lin, est }) => {
      const yByRef = {}
      const drawnSegs = {}

      // LÍNEAS del sistema
      lin.features.forEach(f => {
        const p = f.properties || {}
        const num = refNum(p.nombre_linea)
        if (!num || f.geometry?.type !== 'MultiLineString') return
        const id = `${sys.key}-${num}`

        const color = '#' + (p.color_esp || '888888')
        const segs = f.geometry.coordinates.map(s => s.filter(valid)).filter(s => s.length >= 2)

        if (!metaById[id]) {
          if (yByRef[num] === undefined) yByRef[num] = sys.yBase + Object.keys(yByRef).length * 0.8
          metaById[id] = {
            id, num, sysKey: sys.key, sysLabel: sys.label, color, y: yByRef[num],
            freq: p.frecuencia_minutos || 5,
            speed: (p.velocidad_promedio_kmh || 30) * 1000 / 60,
            dist: p.distancia_metros || 0,
          }
          polyById[id] = chainSegments(segs)
          drawnSegs[id] = new Set()
        }
        const y = metaById[id].y

        // dibujo cada segmento físico una sola vez (evita tronco duplicado en la "Y")
        segs.forEach(seg => {
          const a = seg[0], b = seg[seg.length - 1]
          const ka = `${a[0].toFixed(5)},${a[1].toFixed(5)}`
          const kb = `${b[0].toFixed(5)},${b[1].toFixed(5)}`
          const key = ka < kb ? ka + '|' + kb : kb + '|' + ka
          if (drawnSegs[id].has(key)) return
          drawnSegs[id].add(key)
          const pts = seg.map(c => { const [x, z] = project(c); return [x, y, z] })
          if (pts.length >= 2) lines.push({ id, color, y, pts })
        })
      })

      // ESTACIONES del sistema
      est.features.forEach(f => {
        const p = f.properties || {}
        const num = comercialNum(p.num_comercial)
        const id = `${sys.key}-${num}`
        const m = metaById[id]
        if (!m) return
        const c = f.geometry?.coordinates
        if (!valid(c)) return
        const [x, z] = project(c)
        stations.push({
          pos: [x, m.y + 0.15, z], name: p.nombre, color: m.color, id,
          num, sysKey: sys.key, lon: c[0], lat: c[1],
        })
      })
    })

    // arc por línea (para ordenar etiquetas de distancia)
    const arcOnPoly = (id, lon, lat) => {
      const poly = polyById[id]
      if (!poly || poly.length < 2) return 0
      let bestArc = 0, dMin = Infinity, acc = 0
      for (let i = 0; i < poly.length - 1; i++) {
        const a = poly[i], b = poly[i + 1]
        const segLen = haversine(a, b)
        const dx = b[0] - a[0], dy = b[1] - a[1]
        const len2 = dx * dx + dy * dy || 1e-12
        let t = ((lon - a[0]) * dx + (lat - a[1]) * dy) / len2
        t = Math.max(0, Math.min(1, t))
        const cx = a[0] + dx * t, cy = a[1] + dy * t
        const d = (cx - lon) ** 2 + (cy - lat) ** 2
        if (d < dMin) { dMin = d; bestArc = acc + t * segLen }
        acc += segLen
      }
      return bestArc
    }
    stations.forEach(s => { s.arc = arcOnPoly(s.id, s.lon, s.lat) })

    // grafo
    const adj = stations.map(() => [])
    const addEdge = (a, b, meters, minutes) => {
      adj[a].push({ to: b, meters, minutes }); adj[b].push({ to: a, meters, minutes })
    }

    // conecto estaciones siguiendo CADA ramal (feature) por separado -> respeta las "Y"
    datasets.forEach(({ sys, lin }) => {
      lin.features.forEach(f => {
        const p = f.properties || {}
        const num = refNum(p.nombre_linea)
        if (!num) return
        const id = `${sys.key}-${num}`
        const meta = metaById[id]
        if (!meta) return
        const segs = f.geometry.coordinates.map(s => s.filter(valid)).filter(s => s.length >= 2)
        const poly = chainSegments(segs)
        if (poly.length < 2) return

        const cum = [0]
        for (let i = 1; i < poly.length; i++) cum[i] = cum[i - 1] + haversine(poly[i - 1], poly[i])

        const projOnThis = (lon, lat) => {
          let bestArc = 0, dMin = Infinity
          for (let i = 0; i < poly.length - 1; i++) {
            const a = poly[i], b = poly[i + 1]
            const dx = b[0] - a[0], dy = b[1] - a[1]
            const len2 = dx * dx + dy * dy || 1e-12
            let t = ((lon - a[0]) * dx + (lat - a[1]) * dy) / len2
            t = Math.max(0, Math.min(1, t))
            const cx = a[0] + dx * t, cy = a[1] + dy * t
            const d = (cx - lon) ** 2 + (cy - lat) ** 2
            if (d < dMin) { dMin = d; bestArc = cum[i] + t * (cum[i + 1] - cum[i]) }
          }
          return { arc: bestArc, d: Math.sqrt(dMin) }
        }

        const onRamal = stations
          .map((s, i) => ({ i, s }))
          .filter(({ s }) => s.id === id)
          .map(({ i, s }) => ({ i, ...projOnThis(s.lon, s.lat) }))
          .filter(o => o.d < 0.003)   // ~300m: descarta estaciones de la otra rama
          .sort((a, b) => a.arc - b.arc)

        for (let i = 0; i < onRamal.length - 1; i++) {
          const a = onRamal[i].i, b = onRamal[i + 1].i
          const meters = haversine([stations[a].lon, stations[a].lat], [stations[b].lon, stations[b].lat])
          if (meters > 3000) continue
          addEdge(a, b, meters, meters / meta.speed)
        }
      })
    })

    // transbordos por nombre (incluye cruces Metro<->Cablebús)
    const byName = {}
    stations.forEach((s, i) => { (byName[s.name] ||= []).push(i) })
    Object.values(byName).forEach(idxs => {
      for (let i = 0; i < idxs.length; i++)
        for (let j = i + 1; j < idxs.length; j++) {
          const cross = stations[idxs[i]].sysKey !== stations[idxs[j]].sysKey
          addEdge(idxs[i], idxs[j], 0, cross ? CBB_TRANSFER_MIN : TRANSFER_MIN)
        }
    })

    // distancias entre consecutivas (por id, ordenadas por arc)
    const byId = {}
    stations.forEach((s, i) => { (byId[s.id] ||= []).push(i) })
    const distLabels = []
    Object.entries(byId).forEach(([id, idxs]) => {
      idxs.sort((a, b) => stations[a].arc - stations[b].arc)
      for (let i = 0; i < idxs.length - 1; i++) {
        const a = stations[idxs[i]], b = stations[idxs[i + 1]]
        const d = haversine([a.lon, a.lat], [b.lon, b.lat])
        if (d < 50 || d > 3000) continue
        distLabels.push({
          pos: [(a.pos[0] + b.pos[0]) / 2, a.pos[1] + 0.3, (a.pos[2] + b.pos[2]) / 2],
          text: fmt(d), id, pair: [idxs[i], idxs[i + 1]],
        })
      }
    })

    // conectores de transbordo (visual)
    const transfers = []
    Object.values(byName).forEach(idxs => {
      if (idxs.length < 2) return
      const arr = idxs.map(i => stations[i]).sort((a, b) => a.pos[1] - b.pos[1])
      for (let i = 0; i < arr.length - 1; i++) transfers.push({ pts: [arr[i].pos, arr[i + 1].pos] })
    })

    // stats agrupados por sistema
    const groups = SYSTEMS.map(sys => ({
      key: sys.key, label: sys.label,
      lines: Object.values(metaById)
        .filter(m => m.sysKey === sys.key)
        .map(m => ({
          id: m.id, num: m.num, color: m.color,
          count: (byId[m.id] || []).length,
          dist: fmt(m.dist), time: Math.round(m.dist / m.speed), freq: m.freq,
        }))
        .sort((a, b) => sys.order.indexOf(a.num) - sys.order.indexOf(b.num)),
    })).filter(g => g.lines.length)

    const names = [...new Set(stations.map(s => s.name))].sort((a, b) => a.localeCompare(b))
    return { lines, stations, adj, distLabels, transfers, groups, names }
  }, [datasets])

  useEffect(() => { if (built) onMeta?.({ groups: built.groups, names: built.names }) }, [built, onMeta])

  // ruta más rápida
  const route = useMemo(() => {
    if (!built || !origin || !dest || origin === dest) return null
    const { stations, adj } = built
    const starts = stations.map((_, i) => i).filter(i => stations[i].name === origin)
    const goals = new Set(stations.map((_, i) => i).filter(i => stations[i].name === dest))
    if (!starts.length || !goals.size) return null
    const N = stations.length
    const dist = Array(N).fill(Infinity), meters = Array(N).fill(0)
    const prev = Array(N).fill(-1), vis = Array(N).fill(false)
    starts.forEach(i => dist[i] = 0)
    let goal = -1
    while (true) {
      let u = -1, best = Infinity
      for (let i = 0; i < N; i++) if (!vis[i] && dist[i] < best) { best = dist[i]; u = i }
      if (u === -1) break
      vis[u] = true
      if (goals.has(u)) { goal = u; break }
      for (const e of adj[u]) {
        const nd = dist[u] + e.minutes
        if (nd < dist[e.to]) { dist[e.to] = nd; meters[e.to] = meters[u] + e.meters; prev[e.to] = u }
      }
    }
    if (goal === -1) return null
    const path = []
    for (let u = goal; u !== -1; u = prev[u]) path.unshift(u)
    const steps = []
    let cur = null
    path.forEach(idx => {
      const s = stations[idx]
      if (!cur || cur.id !== s.id) {
        cur = { id: s.id, num: s.num, sysKey: s.sysKey, color: s.color, from: s.name, to: s.name, count: 1 }
        steps.push(cur)
      } else { cur.to = s.name; cur.count++ }
    })
    return { path, steps, minutes: Math.round(dist[goal]), meters: meters[goal] }
  }, [built, origin, dest])

  useEffect(() => { onRoute?.(route ? { steps: route.steps, minutes: route.minutes, dist: fmt(route.meters) } : null) }, [route, onRoute])

  if (!built) return null
  const { lines, stations, distLabels, transfers } = built
  const routeActive = !!route
  const pathSet = new Set(route?.path || [])
  const dimLine = (id) => routeActive ? 0.1 : (selected && selected !== id ? 0.08 : 1)

  const routeSegs = []
  if (route) for (let i = 0; i < route.path.length - 1; i++) {
    const a = stations[route.path[i]], b = stations[route.path[i + 1]]
    routeSegs.push({ pts: [a.pos, b.pos], color: a.id === b.id ? a.color : '#ffffff' })
  }

  return (
    <group>
      {transfers.map((t, i) => (
        <Line key={'t' + i} points={t.pts} color="#ffffff" lineWidth={1.5} transparent opacity={routeActive ? 0.1 : 0.25} />
      ))}
      {lines.map((l, i) => (
        <Line key={i} points={l.pts} color={l.color} lineWidth={4} transparent opacity={dimLine(l.id)} />
      ))}
      {routeSegs.map((s, i) => (
        <Line key={'r' + i} points={s.pts} color={s.color} lineWidth={8} />
      ))}
      {stations.map((s, i) => {
        if (routeActive ? !pathSet.has(i) : (selected && selected !== s.id)) return null
        return (
          <group key={i} position={s.pos}>
            <mesh><sphereGeometry args={[0.4, 12, 12]} />
              <meshStandardMaterial color="#ffffff" emissive="#0a3a3a" emissiveIntensity={0.6} /></mesh>
            <Billboard position={[0, 0.9, 0]}>
              <Text fontSize={0.75} color="#e0f7ff" anchorX="center" anchorY="bottom" outlineWidth={0.05} outlineColor="#0a0e14">{s.name}</Text>
            </Billboard>
          </group>
        )
      })}
      {distLabels.map((d, i) => {
        if (routeActive) {
          const arr = route.path
          const pi = arr.indexOf(d.pair[0]), qi = arr.indexOf(d.pair[1])
          if (pi === -1 || qi === -1 || Math.abs(pi - qi) !== 1) return null
        } else if (selected && selected !== d.id) return null
        return (
          <Billboard key={'d' + i} position={d.pos}>
            <Text fontSize={0.55} color="#9fb8c8" anchorX="center" anchorY="middle" outlineWidth={0.04} outlineColor="#0a0e14">{d.text}</Text>
          </Billboard>
        )
      })}
    </group>
  )
}