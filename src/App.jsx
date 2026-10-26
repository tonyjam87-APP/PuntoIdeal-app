import { useEffect, useMemo, useState } from 'react'
import DeckGL from '@deck.gl/react'
import { ColumnLayer, TextLayer } from '@deck.gl/layers'
import { Map as MapaBase } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { supabase, faltanClaves } from './supabase.js'

// Mapa base gratuito (no requiere clave)
const ESTILO_MAPA = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'

// Semáforo de potencial comercial
const COLORES = {
  Alto: [38, 166, 91],
  Medio: [245, 185, 30],
  Bajo: [220, 62, 62],
}
const colorCss = (nivel) => {
  const c = COLORES[nivel] || [128, 128, 128]
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

// Vistas del mapa: 3D (Perón queda casi horizontal) y aérea (desde arriba)
const CENTRO = { longitude: -58.74432, latitude: -34.51859 }
const VISTA_3D = { ...CENTRO, zoom: 17, pitch: 55, bearing: 41 }
const VISTA_AEREA = { ...CENTRO, zoom: 17, pitch: 0, bearing: 0 }

const ALTURA_POR_PUNTO = 3 // metros de altura de columna por cada punto de score

const textoHora = (h) => `${String(h).padStart(2, '0')}:00`
const franja = (h) => (h >= 6 && h < 12 ? 'Mañana' : h >= 12 && h < 19 ? 'Tarde' : 'Noche')

function Barra({ titulo, valor, detalle }) {
  return (
    <div className="barra">
      <div className="barra-titulo">
        <span>{titulo}</span>
        <span>{valor.toFixed(0)} / 100</span>
      </div>
      <div className="barra-fondo">
        <div className="barra-relleno" style={{ width: `${Math.max(0, Math.min(100, valor))}%` }} />
      </div>
      {detalle && <div className="barra-detalle">{detalle}</div>}
    </div>
  )
}

export default function App() {
  const [base, setBase] = useState([]) // tabla esquinas (posición y datos fijos)
  const [porHora, setPorHora] = useState([]) // tabla esquinas_hora (valores de cada hora)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [hora, setHora] = useState(12)
  const [reproduciendo, setReproduciendo] = useState(false)
  const [seleccionadaId, setSeleccionadaId] = useState(null)
  const [es3D, setEs3D] = useState(true)
  const [vista, setVista] = useState(VISTA_3D)

  const cambiarVista = () => {
    setVista({ ...(es3D ? VISTA_AEREA : VISTA_3D), transitionDuration: 800 })
    setEs3D(!es3D)
  }

  // 1) Consulta a Supabase (dos tablas)
  useEffect(() => {
    if (faltanClaves) {
      setCargando(false)
      return
    }
    async function cargar() {
      const [r1, r2] = await Promise.all([
        supabase.from('esquinas').select('*').order('id'),
        supabase.from('esquinas_hora').select('*'),
      ])
      if (r1.error || r2.error) {
        const msg = (r1.error || r2.error).message
        console.error('Error al consultar Supabase:', r1.error || r2.error)
        setError(msg)
      } else {
        console.log('Esquinas desde Supabase:', r1.data)
        console.log('Valores por hora desde Supabase:', r2.data.length, 'filas')
        setBase(
          r1.data.map((d) => ({ ...d, latitud: Number(d.latitud), longitud: Number(d.longitud) }))
        )
        setPorHora(
          r2.data.map((d) => ({
            id_esquina: d.id_esquina,
            hora: d.hora,
            atraccion: Number(d.atraccion),
            negocios_abiertos: Number(d.negocios_abiertos),
            score_atraccion: Number(d.score_atraccion),
            score_actividad: Number(d.score_actividad),
            score_conectividad: Number(d.score_conectividad),
            score: Number(d.score),
            potencial: d.potencial,
          }))
        )
      }
      setCargando(false)
    }
    cargar()
  }, [])

  // Reproducción automática de las 24 horas
  useEffect(() => {
    if (!reproduciendo) return
    const id = setInterval(() => setHora((h) => (h + 1) % 24), 1000)
    return () => clearInterval(id)
  }, [reproduciendo])

  // 2) Valores de cada esquina para la hora elegida
  const esquinas = useMemo(() => {
    const filas = {}
    porHora.forEach((r) => {
      filas[`${r.id_esquina}-${r.hora}`] = r
    })
    return base
      .map((e) => {
        const r = filas[`${e.id}-${hora}`]
        return r ? { ...e, ...r } : null
      })
      .filter(Boolean)
  }, [base, porHora, hora])

  // 3) Indicadores calculados con los datos de Supabase
  const kpis = useMemo(() => {
    if (!esquinas.length) return null
    const promedio = esquinas.reduce((s, e) => s + e.score, 0) / esquinas.length
    const altos = esquinas.filter((e) => e.potencial === 'Alto').length
    const mejor = esquinas.reduce((a, b) => (b.score > a.score ? b : a))
    // Horario pico del tramo: la hora con mayor score promedio
    const suma = {}
    const cant = {}
    porHora.forEach((r) => {
      suma[r.hora] = (suma[r.hora] || 0) + r.score
      cant[r.hora] = (cant[r.hora] || 0) + 1
    })
    let horaPico = 0
    let maxProm = -1
    Object.keys(suma).forEach((h) => {
      const p = suma[h] / cant[h]
      if (p > maxProm) {
        maxProm = p
        horaPico = Number(h)
      }
    })
    return { promedio, altos, mejor, horaPico }
  }, [esquinas, porHora])

  const ranking = useMemo(() => [...esquinas].sort((a, b) => b.score - a.score), [esquinas])
  const seleccionada = esquinas.find((e) => e.id === seleccionadaId) || null

  // 4) Capas de deck.gl: columnas 3D + etiquetas
  const capas = [
    new ColumnLayer({
      id: 'columnas-esquinas',
      data: esquinas,
      diskResolution: 16,
      radius: 18,
      extruded: true,
      pickable: true,
      autoHighlight: true,
      getPosition: (d) => [d.longitud, d.latitud], // deck.gl usa [longitud, latitud]
      getElevation: (d) => Math.max(d.score, 2) * ALTURA_POR_PUNTO,
      getFillColor: (d) => [...(COLORES[d.potencial] || [128, 128, 128]), 235],
      transitions: { getElevation: 500, getFillColor: 500 },
      onClick: ({ object }) => setSeleccionadaId(object ? object.id : null),
    }),
    new TextLayer({
      id: 'etiquetas-esquinas',
      data: esquinas,
      pickable: false,
      getPosition: (d) => [d.longitud, d.latitud, Math.max(d.score, 2) * ALTURA_POR_PUNTO + 8],
      getText: (d) => d.nombre.replace(' y Perón', ''),
      getSize: 13,
      getPixelOffset: (d) => [0, d.id % 2 === 0 ? -24 : 0],
      getColor: [30, 30, 30, 255],
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'bottom',
      background: true,
      getBackgroundColor: [255, 255, 255, 210],
      backgroundPadding: [4, 2],
      characterSet: 'auto',
    }),
  ]

  const tooltip = ({ object }) =>
    object && {
      html: `<b>${object.nombre}</b><br/>A las ${textoHora(hora)}: potencial ${object.potencial.toLowerCase()}<br/>Score: ${object.score.toFixed(1)} / 100`,
      style: {
        backgroundColor: 'white',
        color: '#222',
        fontSize: '13px',
        borderRadius: '8px',
        padding: '8px 10px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
      },
    }

  return (
    <div className="app">
      <header className="cabecera">
        <h1>PuntoIdeal</h1>
        <p>Potencial comercial de Av. Perón, entre la Ruta 197 y Pueyrredón (José C. Paz) · {base.length || 7} esquinas</p>
      </header>

      <section className="horabar">
        <div className="hora-etiqueta">
          <span className="hora-grande">{textoHora(hora)}</span>
          <span className="hora-franja">{franja(hora)}</span>
        </div>
        <button className="btn" onClick={() => setReproduciendo(!reproduciendo)}>
          {reproduciendo ? '⏸ Pausar' : '▶ Recorrer el día'}
        </button>
        <div className="slider-caja">
          <input
            type="range"
            min="0"
            max="23"
            step="1"
            value={hora}
            onChange={(e) => {
              setReproduciendo(false)
              setHora(Number(e.target.value))
            }}
          />
          <div className="slider-marcas">
            <span>00</span>
            <span>06</span>
            <span>12</span>
            <span>18</span>
            <span>23</span>
          </div>
        </div>
      </section>

      <section className="kpis">
        <div className="kpi">
          <span className="kpi-valor">{kpis ? kpis.promedio.toFixed(1) : '–'}</span>
          <span className="kpi-titulo">Score promedio a las {textoHora(hora)}</span>
        </div>
        <div className="kpi">
          <span className="kpi-valor">{kpis ? kpis.altos : '–'}</span>
          <span className="kpi-titulo">Esquinas de alto potencial ahora</span>
        </div>
        <div className="kpi">
          <span className="kpi-valor kpi-texto">{kpis ? kpis.mejor.nombre.replace(' y Perón', '') : '–'}</span>
          <span className="kpi-titulo">Mejor esquina{kpis ? ` (${kpis.mejor.score.toFixed(1)})` : ''}</span>
        </div>
        <div className="kpi">
          <span className="kpi-valor">{kpis ? textoHora(kpis.horaPico) : '–'}</span>
          <span className="kpi-titulo">Horario pico del tramo</span>
        </div>
      </section>

      <main className="mapa">
        {faltanClaves ? (
          <div className="aviso">
            Faltan las claves de Supabase. Creá el archivo <code>.env</code> (copiá <code>.env.example</code>) y
            completá <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_KEY</code>.
          </div>
        ) : error ? (
          <div className="aviso">
            No se pudieron leer los datos de Supabase: {error}
            <br />
            (Si dice que no existe la tabla <code>esquinas_hora</code>, falta ejecutar el script SQL de las horas.)
          </div>
        ) : (
          <>
            <DeckGL
              initialViewState={vista}
              controller={true}
              layers={capas}
              getTooltip={tooltip}
              onClick={(info) => {
                if (!info.object) setSeleccionadaId(null)
              }}
            >
              <MapaBase mapStyle={ESTILO_MAPA} />
            </DeckGL>

            {cargando && <div className="cargando">Cargando datos…</div>}

            <button
              className="panel boton-vista"
              onClick={cambiarVista}
            >
              {es3D ? 'Ver desde arriba' : 'Ver en 3D'}
            </button>

            {seleccionada && (
              <aside className="panel detalle">
                <button className="cerrar" onClick={() => setSeleccionadaId(null)} aria-label="Cerrar">
                  ×
                </button>
                <h3>{seleccionada.nombre}</h3>
                <span className="etiqueta" style={{ background: colorCss(seleccionada.potencial) }}>
                  Potencial {seleccionada.potencial.toLowerCase()} a las {textoHora(hora)}
                </span>
                <p className="score-grande">{seleccionada.score.toFixed(1)} / 100</p>
                <Barra titulo="Atracción de lugares" valor={seleccionada.score_atraccion} />
                <Barra
                  titulo="Actividad comercial"
                  valor={seleccionada.score_actividad}
                  detalle={`${seleccionada.negocios_abiertos} negocios abiertos en las 2 cuadras cercanas`}
                />
                <Barra titulo="Conectividad" valor={seleccionada.score_conectividad} />
              </aside>
            )}

            <aside className="panel ranking">
              <h4>Ranking a las {textoHora(hora)}</h4>
              <ol>
                {ranking.map((e) => (
                  <li key={e.id} onClick={() => setSeleccionadaId(e.id)}>
                    <span className="punto" style={{ background: colorCss(e.potencial) }} />
                    <span className="nombre">{e.nombre.replace(' y Perón', '')}</span>
                    <span className="valor">{e.score.toFixed(1)}</span>
                  </li>
                ))}
              </ol>
            </aside>

            <aside className="panel leyenda">
              <div><span className="punto" style={{ background: colorCss('Alto') }} /> Alto potencial (60 o más)</div>
              <div><span className="punto" style={{ background: colorCss('Medio') }} /> Potencial medio (45 a 59)</div>
              <div><span className="punto" style={{ background: colorCss('Bajo') }} /> Bajo potencial (menos de 45)</div>
              <small>La altura y el color de cada columna cambian con la hora.</small>
            </aside>
          </>
        )}
      </main>

      <footer className="pie">
        Prueba de concepto. Flujo de personas simulado con un modelo de sintaxis espacial y horarios supuestos; negocios y
        lugares relevados por el equipo (Street View 2025). Día hábil. El score es relativo a este tramo.
      </footer>
    </div>
  )
}
