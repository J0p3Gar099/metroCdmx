import { useEffect, useMemo, useState } from 'react'
import { Line, Billboard, Text } from '@react-three/drei'

const COLORS = {
  '1': '#f04e98', '2': '#005eb8', '3': '#a3a000', '4': '#6dcff6',
  '5': '#ffd200', '6': '#e4002b', '7': '#e87722', '8': '#009a44',
  '9': '#65371f', 'A': '#722282', 'B': '#8e9b87', '12': '#c8a951',
}
const ORDER = ['1','2','3','4','5','6','7','8','9','A','B','12']
const SPEED = 35000 / 60     // m/min (35 km/h promedio)
const TRANSFER_MIN = 5       // minutos por transbordo

function lineRef(p) {
  if (p.ref) return p.ref.toString().trim()
  const m = (p.name || '').match(/L[íi]nea\s+([0-9AB]+)/i)
  return m ? m[1].toUpperCase() : ''
}
function haversine([lon1, lat1], [lon2, lat2]) {
  const R = 6371000, rad = d => d * Math.PI / 180
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
function makeProjector(features) {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity
  const scan = (c) => c.forEach(([lon, lat]) => {
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon)
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat)
  })
  features.forEach(f => {
    const g = f.geometry; if (!g) return
    if (g.type === 'LineString') scan(g.coordinates)
    else if (g.type === 'MultiLineString') g.coordinates.forEach(scan)
    else if (g.type === 'Point') scan([g.coordinates])
  })
  const cLon = (minLon + maxLon) / 2, cLat = (minLat + maxLat) / 2
  const k = Math.cos(cLat * Math.PI / 180)
  const w = (maxLon - minLon) * k, h = (maxLat - minLat)
  const scale = 120 / Math.max(w, h)
  return ([lon, lat]) => [(lon - cLon) * k * scale, -(lat - cLat) * scale]
}
const fmt = (m) => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`

export default function MetroMap({ url, selected, origin, dest, onMeta, onRoute }) {
  const [data, setData] = useState(null)
  useEffect(() => { fetch(url).then(r => r.json()).then(setData).catch(console.error) }, [url])

  const built = useMemo(() => {
    if (!data) return null
    const project = makeProjector(data.features)
    const lines = [], yByRef = {}

    data.features.forEach(f => {
      const g = f.geometry, p = f.properties || {}
      if (!g) return
      if (g.type === 'LineString' || g.type === 'MultiLineString') {
        const ref = lineRef(p)
        const color = p.colour || COLORS[ref] || '#888888'
        if (yByRef[ref] === undefined) yByRef[ref] = Object.keys(yByRef).length * 0.8
        const y = yByRef[ref]
        const segs = g.type === 'LineString' ? [g.coordinates] : g.coordinates
        segs.forEach(seg => {
          const pts = seg.map(c => { const [x, z] = project(c); return [x, y, z] })
          const cum = [0]
          for (let i = 1; i < seg.length; i++) cum[i] = cum[i - 1] + haversine(seg[i - 1], seg[i])
          lines.push({ ref, color, y, pts, cum })
        })
      }
    })

    const nearestOnLine = (l, px, pz) => {
      let best = null, dMin = Infinity
      for (let i = 0; i < l.pts.length - 1; i++) {
        const [ax, ay, az] = l.pts[i], [bx, by, bz] = l.pts[i + 1]
        const dx = bx - ax, dz = bz - az
        const len2 = dx * dx + dz * dz || 1e-9
        let t = ((px - ax) * dx + (pz - az) * dz) / len2
        t = Math.max(0, Math.min(1, t))
        const cx = ax + dx * t, cz = az + dz * t
        const d = (cx - px) ** 2 + (cz - pz) ** 2
        if (d < dMin) { dMin = d; best = { x: cx, y: ay + (by - ay) * t, z: cz, d, arc: l.cum[i] + t * (l.cum[i + 1] - l.cum[i]) } }
      }
      return best
    }

    const SLACK = 0.8, seen = new Set(), stations = []
    data.features.forEach(f => {
      const g = f.geometry, p = f.properties || {}
      if (g?.type !== 'Point' || !p.name) return
      const [px, pz] = project(g.coordinates)
      const byRef = {}
      lines.forEach((l, li) => {
        const n = nearestOnLine(l, px, pz); if (!n) return
        const dist = Math.sqrt(n.d)
        if (!byRef[l.ref] || dist < byRef[l.ref].dist) byRef[l.ref] = { dist, n, li }
      })
      const refs = Object.values(byRef); if (!refs.length) return
      const dNear = Math.min(...refs.map(r => r.dist))
      refs.filter(r => r.dist <= dNear + SLACK).forEach(r => {
        const ref = lines[r.li].ref, key = p.name + '|' + ref
        if (seen.has(key)) return
        seen.add(key)
        stations.push({ pos: [r.n.x, r.n.y + 0.15, r.n.z], name: p.name, color: lines[r.li].color, ref, li: r.li, arc: r.n.arc })
      })
    })

    // grafo
    const adj = stations.map(() => [])
    const addEdge = (a, b, meters, minutes) => {
      adj[a].push({ to: b, meters, minutes }); adj[b].push({ to: a, meters, minutes })
    }
    const byLi = {}
    stations.forEach((s, i) => { (byLi[s.li] ||= []).push(i) })
    Object.values(byLi).forEach(idxs => {
      idxs.sort((a, b) => stations[a].arc - stations[b].arc)
      for (let i = 0; i < idxs.length - 1; i++) {
        const a = idxs[i], b = idxs[i + 1], m = Math.abs(stations[b].arc - stations[a].arc)
        if (m < 10) continue
        addEdge(a, b, m, m / SPEED)
      }
    })
    const byName = {}
    stations.forEach((s, i) => { (byName[s.name] ||= []).push(i) })
    Object.values(byName).forEach(idxs => {
      for (let i = 0; i < idxs.length; i++)
        for (let j = i + 1; j < idxs.length; j++) addEdge(idxs[i], idxs[j], 0, TRANSFER_MIN)
    })

    // labels de distancia entre estaciones consecutivas
    const distLabels = []
    Object.values(byLi).forEach(idxs => {
      idxs.sort((a, b) => stations[a].arc - stations[b].arc)
      for (let i = 0; i < idxs.length - 1; i++) {
        const ia = idxs[i], ib = idxs[i + 1]
        const a = stations[ia], b = stations[ib], d = b.arc - a.arc
        if (d < 50) continue
        distLabels.push({
          pos: [(a.pos[0] + b.pos[0]) / 2, a.pos[1] + 0.3, (a.pos[2] + b.pos[2]) / 2],
          text: fmt(d),
          ref: a.ref,
          pair: [ia, ib],
        })
      }
    })

    // conectores de transbordo
    const transfers = []
    Object.values(byName).forEach(idxs => {
      if (idxs.length < 2) return
      const arr = idxs.map(i => stations[i]).sort((a, b) => a.pos[1] - b.pos[1])
      for (let i = 0; i < arr.length - 1; i++) transfers.push({ pts: [arr[i].pos, arr[i + 1].pos] })
    })

    // stats por línea
    const statMap = {}
    stations.forEach(s => { (statMap[s.ref] ||= { ref: s.ref, color: s.color, names: new Set() }).names.add(s.name) })
    lines.forEach(l => { const st = statMap[l.ref]; if (st) st.total = Math.max(st.total || 0, l.cum.at(-1) || 0) })
    const stats = Object.values(statMap).map(s => ({
      ref: s.ref, color: s.color, count: s.names.size, dist: fmt(s.total || 0), time: Math.round((s.total || 0) / SPEED),
    })).sort((a, b) => ORDER.indexOf(a.ref) - ORDER.indexOf(b.ref))

    const names = [...new Set(stations.map(s => s.name))].sort((a, b) => a.localeCompare(b))
    return { lines, stations, adj, distLabels, transfers, stats, names }
  }, [data])

  useEffect(() => {
    if (built) onMeta?.({ stats: built.stats, names: built.names })
  }, [built, onMeta])

  // ruta más rápida (Dijkstra por tiempo)
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
      if (!cur || cur.ref !== s.ref) {
        cur = { ref: s.ref, color: s.color, from: s.name, to: s.name, count: 1 }
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
  const dimLine = (ref) => routeActive ? 0.1 : (selected && selected !== ref ? 0.08 : 1)

  const routeSegs = []
  if (route) for (let i = 0; i < route.path.length - 1; i++) {
    const a = stations[route.path[i]], b = stations[route.path[i + 1]]
    routeSegs.push({ pts: [a.pos, b.pos], color: a.ref === b.ref ? a.color : '#ffffff' })
  }

  return (
    <group>
      {/* conectores de transbordo */}
      {transfers.map((t, i) => (
        <Line key={'t' + i} points={t.pts} color="#ffffff" lineWidth={1.5} transparent opacity={routeActive ? 0.1 : 0.25} />
      ))}

      {/* líneas */}
      {lines.map((l, i) => (
        <Line key={i} points={l.pts} color={l.color} lineWidth={4} transparent opacity={dimLine(l.ref)} />
      ))}

      {/* ruta resaltada */}
      {routeSegs.map((s, i) => (
        <Line key={'r' + i} points={s.pts} color={s.color} lineWidth={8} />
      ))}

      {/* estaciones */}
      {stations.map((s, i) => {
        if (routeActive ? !pathSet.has(i) : (selected && selected !== s.ref)) return null
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

      {/* distancias */}
      {distLabels.map((d, i) => {
        if (routeActive) {
          const arr = route.path
          const pi = arr.indexOf(d.pair[0]), qi = arr.indexOf(d.pair[1])
          if (pi === -1 || qi === -1 || Math.abs(pi - qi) !== 1) return null
        } else if (selected && selected !== d.ref) {
          return null
        }
        return (
          <Billboard key={'d' + i} position={d.pos}>
            <Text fontSize={0.55} color="#9fb8c8" anchorX="center" anchorY="middle" outlineWidth={0.04} outlineColor="#0a0e14">{d.text}</Text>
          </Billboard>
        )
      })}
    </group>
  )
}