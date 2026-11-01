import { useEffect, useMemo, useRef, useState } from 'react'
import DeckGL from '@deck.gl/react'
import { ColumnLayer, TextLayer, ScatterplotLayer, PathLayer, IconLayer } from '@deck.gl/layers'
import { Map } from 'react-map-gl/maplibre'
import { supabase, faltanClaves } from './supabase'

const COLOR = { Saturado: [214, 52, 52], Cargado: [240, 160, 30], Fluido: [46, 160, 90] }
const SENTIDOS = ['Hacia 197 (noroeste)', 'Hacia San Miguel (sudeste)']
const VISTA = { longitude: -58.7435, latitude: -34.5196, zoom: 16.2, pitch: 50, bearing: -45 }
const VISTA_PLANA = { ...VISTA, pitch: 0, bearing: 0 }
const MAPA = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
const DESVIO_COLOR = [[37, 99, 235], [124, 58, 237], [13, 148, 136], [219, 39, 119]]

// ---------- Geometría de las rutas ----------
const M = 111320
const mover = (lat, lon, rumbo, m) => {
  const b = (rumbo * Math.PI) / 180
  return [lat + (m * Math.cos(b)) / M, lon + (m * Math.sin(b)) / (M * Math.cos((lat * Math.PI) / 180))]
}
const C = {
  c197: [-34.516764, -58.746806], jcp: [-34.517377, -58.746017], altube: [-34.518017, -58.745164],
  lavalle: [-34.518621, -58.744304], arias: [-34.51923, -58.743523], suarez: [-34.51983, -58.742647],
  pue: [-34.520418, -58.741839], newbery: [-34.5211825, -58.740851], solis: [-34.52188, -58.7399415], cb: [-34.522468, -58.7391435],
}
// Puntos por los que debe pasar cada ruta (lat, lon). Se ajustan mirando el mapa.
const WP = {
  // A mitad de cuadra (no en las esquinas) para que la ruta no dé vueltas por las calles que cruzan
  peron: [C.c197, C.jcp, C.altube, C.lavalle, C.arias, C.suarez, C.pue, C.newbery, C.solis, C.cb].slice(1).map((c, i, a) => {
    const p = i === 0 ? C.c197 : a[i - 1]
    return [(p[0] + c[0]) / 2, (p[1] + c[1]) / 2]
  }),
  d1: [mover(...C.c197, 243, 118), mover(...C.cb, 222, 110), C.cb, mover(...C.cb, 132, 150)], // vuelve a Perón en Castro Barros y sigue hacia San Miguel; // sale de 197 y va recto por Sarmiento hasta Castro Barros
  d2a: [C.pue, mover(...C.pue, 222, 320)],
  d2b: [C.lavalle, mover(...C.lavalle, 222, 300)], // termina en Alem (no se pueden cruzar las vías); ajustar los 300 m si hace falta
  // Rosa: sale de Perón en Newbery, sube a Favaloro y sigue a la derecha, rumbo a Malvinas
  d3: [C.newbery, mover(...C.newbery, 42, 345), mover(...mover(...C.newbery, 42, 345), 312, 603), mover(...mover(...mover(...C.newbery, 42, 345), 312, 603), 63, 300)],
  // Ruta 197 (rumbo suroeste a noreste), pasando por Perón
  r197: [mover(...C.c197, 243, 450), mover(...C.c197, 63, 450)],
}
const RECTAS = ['d1', 'd2a', 'd2b', 'd3', 'r197'] // calles cortas y derechas: línea recta, sin pedir ruta
const dist = (a, b) => {
  const dx = (b[0] - a[0]) * M * Math.cos((a[1] * Math.PI) / 180), dy = (b[1] - a[1]) * M
  return Math.hypot(dx, dy)
}
const armar = (pts) => {
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]))
  return { pts, cum, len: cum[cum.length - 1] || 1 }
}
const enRuta = (r, s, carril = 3.5) => {
  const { pts, cum } = r
  let i = 1
  while (i < cum.length - 1 && cum[i] < s) i++
  const a = pts[i - 1], b = pts[i], t = Math.min(1, Math.max(0, (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1)))
  const lon = a[0] + (b[0] - a[0]) * t, lat = a[1] + (b[1] - a[1]) * t
  const rumbo = Math.atan2((b[0] - a[0]) * Math.cos((lat * Math.PI) / 180), b[1] - a[1])
  const lado = rumbo + Math.PI / 2
  return {
    pos: [lon + (carril * Math.sin(lado)) / (M * Math.cos((lat * Math.PI) / 180)), lat + (carril * Math.cos(lado)) / M],
    rumbo: (rumbo * 180) / Math.PI,
  }
}
// Ícono de auto visto desde arriba (apunta al norte); se pinta del color que se le pida
const AUTO_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='64' height='128' viewBox='0 0 64 128'><path fill-rule='evenodd' fill='white' d='M24 4H40Q56 4 56 24V104Q56 124 40 124H24Q8 124 8 104V24Q8 4 24 4ZM16 30H48V50H16ZM16 82H48V102H16Z'/></svg>"
const AUTO_URL = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(AUTO_SVG)
const FLECHA_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'><path fill='white' d='M32 4L58 56L32 44L6 56Z'/></svg>"
const FLECHA_ICONO = { url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(FLECHA_SVG), width: 64, height: 64, mask: true }
// Semáforo dibujado: caja gris con visera, tres luces, poste y base; se prende la luz del estado
const semSvg = (prendida) => {
  const luz = (cy, on, off) => (prendida === cy ? `<circle cx='40' cy='${cy}' r='17' fill='${on}' opacity='0.35'/><circle cx='40' cy='${cy}' r='11' fill='${on}' stroke='#222' stroke-width='2.5'/><circle cx='36' cy='${cy - 4}' r='3.5' fill='white' opacity='0.8'/>` : `<circle cx='40' cy='${cy}' r='10' fill='${off}' stroke='#222' stroke-width='2.5'/>`)
  const visera = (y) => `<path d='M26 ${y}L8 ${y + 4}L8 ${y + 12}L28 ${y + 10}Z M54 ${y}L72 ${y + 4}L72 ${y + 12}L52 ${y + 10}Z' fill='#9aa0a6' stroke='#222' stroke-width='2.5' stroke-linejoin='round'/>`
  return "<svg xmlns='http://www.w3.org/2000/svg' width='80' height='170' viewBox='0 0 80 170'>" +
    "<path d='M34 112H46V150H34Z' fill='#8d949b' stroke='#222' stroke-width='2.5'/><path d='M18 164L30 150H50L62 164Z' fill='#6b7280' stroke='#222' stroke-width='2.5' stroke-linejoin='round'/>" +
    visera(14) + visera(44) + visera(74) +
    "<rect x='26' y='4' width='28' height='112' rx='5' fill='#b8bec4' stroke='#222' stroke-width='3'/>" +
    luz(24, '#ff1f1f', '#a86a6a') + luz(60, '#ffc400', '#b0a06a') + luz(96, '#16e04a', '#6a9a78') + '</svg>'
}
const SEM_ICONO = Object.fromEntries([['Saturado', 24], ['Cargado', 60], ['Fluido', 96]].map(([k, y]) =>
  [k, { id: k, url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(semSvg(y)), width: 80, height: 170, anchorY: 170 }]))
const AUTO_ICONO = { url: AUTO_URL, width: 64, height: 128, anchorY: 64, mask: true }
// Une el recorrido por Perón hasta donde sale el desvío con el recorrido del desvío
const indiceCercano = (pts, p) => {
  let mejor = 0, d = Infinity
  pts.forEach((q, i) => { const x = dist(q, p); if (x < d) { d = x; mejor = i } })
  return mejor
}
const unir = (peron, desvio) => armar(peron.slice(0, indiceCercano(peron, desvio[0]) + 1).concat(desvio))
const pedirRuta = async (wps) => {
  const coords = wps.map(([la, lo]) => `${lo},${la}`).join(';')
  try {
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`)
    const j = await r.json()
    if (j.routes && j.routes[0]) return { pts: j.routes[0].geometry.coordinates, ok: true }
  } catch (e) { /* si falla, queda la línea recta */ }
  return { pts: wps.map(([la, lo]) => [lo, la]), ok: false }
}
const ESCALA_AUTOS = 10 // autos por hora que representa cada punto del mapa
const SEG_POR_HORA = 3 // segundos reales por hora del escenario
const VEL = 15
const MULT_DESVIO = 5 // en hora pico, cuánto se amplifica el % de autos que toma el desvío (el Excel usa el % base) // m/s a velocidad libre
const sinAutos = (h) => h >= 23 || h <= 4 // de noche no circula nadie
// Los desvíos se usan solo en la hora pico (dato del equipo): de 16 a 20 h en 197 y de 17 a 20 h en Pueyrredón
const VENTANA = { 'Perón y 197': [16, 20], 'Perón y Pueyrredón': [17, 20] }
const enVentana = (sem, h) => { const w = VENTANA[sem]; return !!w && h >= w[0] && h < w[1] }
const CICLO = 120 // segundos (60 de verde y 60 de rojo)
const fmt = (n) => Number(n).toLocaleString('es-AR')
const hh = (h) => String(h).padStart(2, '0') + ':00'
const estado = (i) => (i >= 100 ? 'Saturado' : i >= 80 ? 'Cargado' : 'Fluido')

export default function App() {
  const [filas, setFilas] = useState([])
  const [paradas, setParadas] = useState([])
  const [desvios, setDesvios] = useState([])
  const [error, setError] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [hora, setHora] = useState(8)
  const [play, setPlay] = useState(false)
  const [sentido, setSentido] = useState(SENTIDOS[0])
  const [conDesvios, setConDesvios] = useState(false)
  const [verDesvios, setVerDesvios] = useState([true, true, true, true])
  const [plano, setPlano] = useState(false)
  const [sel, setSel] = useState(null)
  const [hover, setHover] = useState(null)
  const timer = useRef(null)
  const [rutas, setRutas] = useState(null)
  const [, setFrame] = useState(0)
  const fase = useRef(0)
  const vel = useRef(VEL)

  useEffect(() => {
    if (faltanClaves) { setError('Faltan las claves de Supabase (VITE_SUPABASE_URL y VITE_SUPABASE_KEY).'); setCargando(false); return }
    Promise.all([
      supabase.from('congestion').select('*').order('id'),
      supabase.from('paradas').select('*').order('id'),
      supabase.from('desvios').select('*').order('id'),
    ]).then(([c, p, d]) => {
      const e = c.error || p.error || d.error
      if (e) setError(e.message)
      else { setFilas(c.data); setParadas(p.data); setDesvios(d.data) }
      setCargando(false)
    })
  }, [])

  useEffect(() => {
    if (!play) return
    timer.current = setInterval(() => setHora((h) => (h + 1) % 24), SEG_POR_HORA * 1000)
    return () => clearInterval(timer.current)
  }, [play])

  // Los autos solo se mueven cuando el escenario está corriendo
  const playRef = useRef(false)
  playRef.current = play
  useEffect(() => {
    let raf, ultimo = performance.now()
    const paso = (t) => {
      if (playRef.current) fase.current += ((t - ultimo) / 1000) * vel.current
      ultimo = t
      if (playRef.current) setFrame((f) => f + 1)
      raf = requestAnimationFrame(paso)
    }
    raf = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Rutas por las calles (servicio de rutas de OpenStreetMap); si falla, línea recta
  useEffect(() => {
    let vivo = true
    Promise.all(Object.entries(WP).map(async ([k, w]) => {
      const v = RECTAS.includes(k) ? { pts: w.map(([la, lo]) => [lo, la]), ok: true } : await pedirRuta(w)
      if (k === 'peron') v.pts = [[C.c197[1], C.c197[0]], ...v.pts, [C.cb[1], C.cb[0]]]
      return [k, v]
    })).then((r) => {
      if (vivo) setRutas(Object.fromEntries(r.map(([k, v]) => [k, { ...armar(v.pts), ok: v.ok }])))
    })
    return () => { vivo = false }
  }, [])

  // valor mostrado según el modo (sin o con desvíos)
  const pctEf = (f) => (enVentana(f.semaforo, f.hora) ? Math.min(0.6, Number(f.pct_desvio) * MULT_DESVIO) : 0)
  const autosEf = (f) => Number(f.autos_hora) * (1 - pctEf(f))
  const indice = (f) => (conDesvios ? Math.min(150, Math.round((100 * autosEf(f)) / Number(f.capacidad))) : Number(f.valor))
  const cat = (f) => (conDesvios ? estado(indice(f)) : f.categoria)
  const cola = (f) => (conDesvios ? Math.round(Math.max(0, autosEf(f) - Number(f.capacidad)) * (CICLO / 3600) * 10) / 10 : Number(f.cola))

  const delSentido = useMemo(() => filas.filter((f) => f.sentido === sentido), [filas, sentido])
  const ahora = useMemo(() => delSentido.filter((f) => f.hora === hora), [delSentido, hora])

  // KPIs calculados con los datos de Supabase
  const kpi = useMemo(() => {
    if (!delSentido.length) return null
    const pico = delSentido.reduce((m, f) => (indice(f) > indice(m) ? f : m), delSentido[0])
    const critico = ahora.length ? ahora.reduce((m, f) => (indice(f) > indice(m) ? f : m), ahora[0]) : null
    const verdeMax = ahora.length ? Math.max(...ahora.map((f) => Number(f.verde_perdido))) : 0
    const saturadas = (sem) => delSentido.filter((f) => f.semaforo === sem && indice(f) >= 100).length
    const sems = [...new Set(delSentido.map((f) => f.semaforo))]
    return { pico, critico, verdeMax, sat: sems.map((s) => [s, saturadas(s)]) }
  }, [delSentido, ahora, conDesvios, hora])

  // ---- Rutas y autos del escenario ----
  const idxMax = ahora.length ? Math.max(...ahora.map((f) => indice(f))) : 0
  const factorVel = Math.max(0.15, 1 - idxMax / 160)
  vel.current = VEL * factorVel
  const todasHora = useMemo(() => filas.filter((f) => f.hora === hora), [filas, hora])
  const prom = (sen, campo) => {
    const r = todasHora.filter((f) => f.sentido === sen)
    return r.length ? r.reduce((t, f) => t + Number(f[campo]), 0) / r.length : 0
  }
  const usoDe = () => (enVentana('Perón y 197', hora) ? 1 : 0)
  // Recorridos completos de cada tipo de auto, según a dónde va
  const viajes = useMemo(() => {
    if (!rutas) return null
    const se = rutas.peron.pts, nw = [...se].reverse()
    const r = rutas.r197.pts, rr = [...r].reverse()
    const c = [C.c197[1], C.c197[0]]
    const i0 = indiceCercano(r, c), iR = indiceCercano(rr, c)
    return {
      derechoSE: armar(se),
      nwNE: armar(nw.concat(r.slice(i0))), nwSW: armar(nw.concat(rr.slice(iR))),
      r197NE: armar(r), r197SW: armar(rr),
      jcpAPeron: armar(r.slice(0, i0 + 1).concat(se)), malvAPeron: armar(rr.slice(0, iR + 1).concat(se)),
      d1: unir(r, rutas.d1.pts),
      d2a: unir(nw, rutas.d2a.pts), d2b: unir(nw, rutas.d2b.pts), d3: unir(nw, rutas.d3.pts),
    }
  }, [rutas])
  const rutasDibujo = []
  const autos = []
  if (rutas && viajes) {
    rutasDibujo.push({ path: rutas.peron.pts, color: [90, 100, 120, 170], ancho: 9 })
    rutasDibujo.push({ path: rutas.r197.pts, color: [90, 100, 120, 120], ancho: 9 })
    desvios.forEach((d, i) => {
      const k = ['d1', 'd2a', 'd2b', 'd3'][i]
      if (!conDesvios || !rutas[k] || !verDesvios[i]) return
      const c = DESVIO_COLOR[(d.id - 1) % 4]
      rutasDibujo.push({ path: rutas[k].pts, color: [...c.map((v) => Math.round(v + (255 - v) * 0.45)), 120], ancho: 9, des: d })
    })
    const poner = (ruta, n, color, desfase, minimo = 0) => {
      const total = n > 0 ? Math.max(minimo, Math.round(n)) : 0
      for (let i = 0; i < total; i++) {
        const u = (i * 0.61803 + desfase) % 1
        autos.push({ ...enRuta(ruta, (u * ruta.len + fase.current) % ruta.len), color })
      }
    }
    if (!sinAutos(hora)) {
      const base = (sen) => prom(sen, 'autos_hora') / ESCALA_AUTOS
      const ven197 = conDesvios && enVentana('Perón y 197', hora)
      const venPue = conDesvios && enVentana('Perón y Pueyrredón', hora)
      const rojo = [15, 15, 15, 255] // todos los autos son negros
      const col = () => [15, 15, 15, 255]
      const pc = (i) => Number(desvios[i]?.porcentaje) || 0
      // Ruta 197: los que vienen de José C. Paz (suroeste) y de Malvinas (noreste)
      const mucho = !conDesvios && (enVentana('Perón y 197', hora) || enVentana('Perón y Pueyrredón', hora)) ? 1.6 : 1 // sin desvíos, Perón se llena en hora pico
      const alivio = ven197 || venPue ? 0.4 : 1 // con desvíos, quedan menos autos sobre Perón
      const f = base(SENTIDOS[1]) * mucho
      const tomaD1 = ven197 && verDesvios[0] // en hora pico todos los que giran a Perón toman Sarmiento
      poner(viajes.r197NE, f * 0.5 * 0.4, rojo, 0.05)
      poner(viajes.jcpAPeron, tomaD1 ? 0 : f * 0.5 * 0.6, rojo, 0.15)
      poner(viajes.d1, tomaD1 ? f * 0.5 * 0.6 : 0, col(0), 0.3, 4)
      poner(viajes.r197SW, f * 0.5 * 0.4, rojo, 0.35)
      poner(viajes.malvAPeron, f * 0.5 * 0.6 * alivio, rojo, 0.45) // los de Malvinas esperan en el semáforo
      poner(viajes.derechoSE, f * 0.3 * alivio, rojo, 0.11)
      // Hacia 197 en hora pico: solo los que van a José C. Paz siguen derecho; el resto toma un desvío
      const nw = base(SENTIDOS[0]) * mucho
      const peso = [venPue && verDesvios[1] ? pc(1) : 0, venPue && verDesvios[2] ? pc(2) : 0, ven197 && verDesvios[3] ? pc(3) : 0]
      const suma = peso[0] + peso[1] + peso[2]
      const aDesvio = suma > 0 ? nw * 0.75 : 0
      if (aDesvio > 0) {
        poner(viajes.nwSW, nw - aDesvio, rojo, 0.63)
        poner(viajes.d2a, aDesvio * peso[0] / suma, col(1), 0.41, peso[0] ? 4 : 0)
        poner(viajes.d2b, aDesvio * peso[1] / suma, col(2), 0.23, peso[1] ? 4 : 0)
        poner(viajes.d3, aDesvio * peso[2] / suma, col(3), 0.77, peso[2] ? 5 : 0)
      } else {
        poner(viajes.nwNE, nw * 0.5, rojo, 0.57)
        poner(viajes.nwSW, nw * 0.5, rojo, 0.63)
      }
    }
  }

  const capas = [
    // Semáforo dibujado; cambia de luz según el tránsito
    new IconLayer({
      id: 'semaforos', data: ahora, pickable: true, getIcon: (f) => SEM_ICONO[cat(f)],
      getPosition: (f) => [f.longitud, f.latitud], getSize: 64, sizeUnits: 'pixels', billboard: true,
      updateTriggers: { getIcon: [conDesvios, hora, sentido] },
      onHover: (i) => setHover(i.object ? { obj: i.object, x: i.x, y: i.y, tipo: 'sem' } : null),
      onClick: (i) => setSel(i.object ? { tipo: 'sem', id: i.object.semaforo } : null),
    }),
    new TextLayer({
      id: 'valores', data: ahora, getPosition: (f) => [f.longitud, f.latitud], getPixelOffset: [0, -78],
      getText: (f) => String(Math.round(indice(f))), getSize: 16, getColor: [20, 33, 61], fontWeight: 700,
      outlineWidth: 3, outlineColor: [255, 255, 255], billboard: true, updateTriggers: { getText: [conDesvios] },
    }),
    new ScatterplotLayer({
      id: 'paradas', data: paradas, pickable: true, getPosition: (p) => [p.longitud, p.latitud],
      getFillColor: [30, 64, 175, 230], getLineColor: [255, 255, 255], stroked: true, lineWidthMinPixels: 1.5,
      getRadius: 9, radiusUnits: 'meters', radiusMinPixels: 5,
      onHover: (i) => setHover(i.object ? { obj: i.object, x: i.x, y: i.y, tipo: 'par' } : null),
    }),
    new PathLayer({
      id: 'rutas', data: rutasDibujo, getPath: (d) => d.path, getColor: (d) => d.color, getWidth: (d) => d.ancho,
      widthUnits: 'meters', widthMinPixels: 2, capRounded: true, jointRounded: true, pickable: true,
      updateTriggers: { getColor: [conDesvios], getWidth: [conDesvios] },
      onHover: (i) => setHover(i.object && i.object.des ? { obj: i.object.des, x: i.x, y: i.y, tipo: 'des' } : null),
    }),
    new IconLayer({
      id: 'flechas', data: rutasDibujo.filter((d) => d.des && d.path.length > 1), getIcon: () => FLECHA_ICONO,
      getPosition: (d) => d.path[d.path.length - 1], getColor: (d) => [...d.color.slice(0, 3), 235],
      getAngle: (d) => { const a = d.path[d.path.length - 2], b = d.path[d.path.length - 1]; return -(Math.atan2((b[0] - a[0]) * Math.cos((b[1] * Math.PI) / 180), b[1] - a[1]) * 180) / Math.PI },
      getSize: 22, sizeUnits: 'meters', sizeMinPixels: 18, sizeMaxPixels: 40, billboard: false,
    }),
    new IconLayer({
      id: 'autos', data: autos, getIcon: () => AUTO_ICONO, getPosition: (a) => a.pos, getColor: (a) => a.color,
      getAngle: (a) => -a.rumbo, getSize: 6, sizeUnits: 'meters', sizeMinPixels: 15, sizeMaxPixels: 44, billboard: false,
    }),
  ]

  const detalle = sel ? ahora.find((f) => f.semaforo === sel.id) : null

  return (
    <div className="app">
      <header className="cabecera">
        <h1>Congestión en Av. Perón · semáforos y desvíos</h1>
        <p>¿Dónde y cuándo se traba Perón, y cuánto bajaría con rutas alternativas? · Tramo 197 a Castro Barros, José C. Paz</p>
      </header>

      <section className="barra">
        <button className="btn" onClick={() => setPlay((p) => !p)}>{play ? '⏸ Pausar escenario' : '▶ Correr escenario'}</button>
        <div className="hora-etiqueta"><span className="hora-grande">{hh(hora)}</span></div>
        <div className="slider-caja">
          <input type="range" min="0" max="23" value={hora} onChange={(e) => { setPlay(false); setHora(Number(e.target.value)) }} />
          <div className="slider-marcas"><span>0</span><span>6</span><span>12</span><span>18</span><span>23</span></div>
        </div>
        <div className="grupo">
          {SENTIDOS.map((s) => (
            <button key={s} className={'chip' + (sentido === s ? ' activo' : '')} onClick={() => setSentido(s)}>{s}</button>
          ))}
        </div>
        <label className="chip check">
          <input type="checkbox" checked={conDesvios} onChange={(e) => setConDesvios(e.target.checked)} /> Con desvíos
        </label>
      </section>

      <section className="kpis">
        <div className="kpi">
          <span className="kpi-valor">{kpi ? hh(kpi.pico.hora) : '—'}</span>
          <span className="kpi-titulo">Hora más congestionada ({kpi ? kpi.pico.semaforo : ''}, índice {kpi ? Math.round(indice(kpi.pico)) : '—'})</span>
        </div>
        <div className="kpi">
          <span className="kpi-valor kpi-texto">{kpi && kpi.critico ? kpi.critico.semaforo : '—'}</span>
          <span className="kpi-titulo">Semáforo más crítico a las {hh(hora)}{kpi && kpi.critico ? ` (índice ${Math.round(indice(kpi.critico))})` : ''}</span>
        </div>
        <div className="kpi">
          <span className="kpi-valor">{kpi ? `${kpi.verdeMax.toLocaleString('es-AR')} s` : '—'}</span>
          <span className="kpi-titulo">Verde perdido por ciclo (de 60 s) a las {hh(hora)}</span>
        </div>
        <div className="kpi">
          <span className="kpi-valor kpi-texto">{kpi ? kpi.sat.map(([s, n]) => `${s.replace('Perón y ', '')}: ${n} h`).join(' · ') : '—'}</span>
          <span className="kpi-titulo">Horas saturadas del día {conDesvios ? '(con desvíos)' : '(sin desvíos)'}</span>
        </div>
      </section>

      <div className="mapa">
        {error && <div className="aviso">⚠️ {error}</div>}
        {cargando && <div className="cargando">Cargando datos…</div>}
        <DeckGL key={plano ? 'p' : 'd'} initialViewState={plano ? VISTA_PLANA : VISTA} controller layers={capas}
          getCursor={({ isHovering }) => (isHovering ? 'pointer' : 'grab')}>
          <Map mapStyle={MAPA} maxZoom={20} />
        </DeckGL>

        <button className="panel boton-vista" onClick={() => setPlano((p) => !p)}>{plano ? 'Vista 3D' : 'Vista aérea'}</button>

        <div className="panel leyenda">
          <b>Índice de congestión</b>
          {Object.entries(COLOR).map(([k, c]) => (
            <div key={k}><span className="punto" style={{ background: `rgb(${c})` }} />{k} {k === 'Saturado' ? '(100 o más)' : k === 'Cargado' ? '(80 a 99)' : '(menos de 80)'}</div>
          ))}
          <div><span className="punto" style={{ background: 'rgb(30,64,175)' }} />Parada de colectivo (182 y 176)</div>
          <small>Altura = índice. 100 = pasan tantos autos como permite el semáforo.</small>
        </div>

        <div className="panel desvios">
          <b>Desvíos</b>
          {desvios.map((d, i) => (
            <label key={d.id}>
              <input type="checkbox" checked={verDesvios[i]} onChange={() => setVerDesvios((v) => v.map((x, j) => (j === i ? !x : x)))} />
              <span className="punto" style={{ background: `rgb(${DESVIO_COLOR[(d.id - 1) % 4]})` }} />{d.nombre} <em>({conDesvios ? Math.round(Math.min(0.6, d.porcentaje * MULT_DESVIO) * usoDe() * 100) : 0} % ahora)</em>
            </label>
          ))}
          <small>Los desvíos se usan solo en hora pico: de 16 a 20 h (197) y de 17 a 20 h (Pueyrredón). </small><small>{rutas ? (Object.values(rutas).every((r) => r.ok) ? 'Rutas por las calles del mapa.' : 'Alguna ruta quedó en línea recta (sin conexión al servicio de rutas).') : 'Calculando rutas…'}</small>
        </div>

        {detalle && (
          <div className="panel detalle">
            <button className="cerrar" onClick={() => setSel(null)}>×</button>
            <h3>{detalle.semaforo}</h3>
            <span className="etiqueta" style={{ background: `rgb(${COLOR[cat(detalle)]})` }}>{cat(detalle)} · {Math.round(indice(detalle))}</span>
            <table><tbody>
              <tr><td>Sentido</td><td>{detalle.sentido}</td></tr>
              <tr><td>Hora</td><td>{hh(detalle.hora)}</td></tr>
              <tr><td>Autos por hora</td><td>{fmt(detalle.autos_hora)}{conDesvios ? ` → ${fmt(Math.round(autosEf(detalle)))}` : ''}</td></tr>
              <tr><td>Capacidad (autos/h)</td><td>{fmt(detalle.capacidad)}</td></tr>
              <tr><td>Paradas que afectan</td><td>{detalle.paradas_afectan}</td></tr>
              <tr><td>Verde perdido por ciclo</td><td>{detalle.verde_perdido} s</td></tr>
              <tr><td>Autos en cola por ciclo</td><td>{cola(detalle)}</td></tr>
              <tr><td>Autos desviados</td><td>{conDesvios ? Math.round(pctEf(detalle) * 100) : 0} %</td></tr>
              <tr><td><b>Mejora con desvíos</b></td><td><b>{conDesvios ? Number(detalle.valor) - indice(detalle) : 0} puntos</b></td></tr>
            </tbody></table>
          </div>
        )}

        {hover && (
          <div className="tooltip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
            {hover.tipo === 'sem' && (<>
              <b>{hover.obj.semaforo}</b>
              <div>Categoría: {cat(hover.obj)}</div>
              <div>Valor: índice {Math.round(indice(hover.obj))}</div>
            </>)}
            {hover.tipo === 'par' && (<>
              <b>Parada de colectivo {hover.obj.id}</b>
              <div>Categoría: Parada (líneas {hover.obj.lineas})</div>
              <div>{hover.obj.nombre}</div>
            </>)}
            {hover.tipo === 'des' && (<>
              <b>{hover.obj.nombre}</b>
              <div>Categoría: Desvío</div>
              <div>Valor: {Math.round(hover.obj.porcentaje * 100)} % de los autos</div>
            </>)}
          </div>
        )}
      </div>
      <footer className="pie">Datos simulados con supuestos (autos, frecuencia de colectivos y porcentaje de desvío); negocios y lugares relevados con Google Maps y Street View 2025 · Fuente: Supabase</footer>
    </div>
  )
}
