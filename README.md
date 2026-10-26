# PuntoIdeal – Potencial comercial de Av. Perón (José C. Paz)

Prueba de concepto: **Supabase → React + Vite → deck.gl → Vercel**.

## Cómo correrlo en tu computadora

1. Descomprimí la carpeta y abrí una terminal dentro de ella.
2. Copiá el archivo `.env.example` con el nombre `.env` y completá los dos datos de tu proyecto de Supabase
   (en Supabase: *Project Settings → API*: la **Project URL** y la clave pública, que aparece como *publishable* o *anon public*).
   No uses la clave secreta (*service_role* o *secret*).
3. Instalá las dependencias: `npm install`
4. Iniciá la app: `npm run dev` y abrí la dirección que aparece (normalmente http://localhost:5173).

Si algo falla, abrí la consola del navegador (F12): la app muestra allí los datos que llegan de Supabase y los errores.

## Cómo publicarlo en Vercel

1. Subí la carpeta a un repositorio de GitHub (el archivo `.env` NO se sube, ya está en `.gitignore`).
2. En vercel.com, *Add New → Project*, elegí el repositorio. Vercel detecta Vite solo.
3. Antes de desplegar, en *Environment Variables* agregá `VITE_SUPABASE_URL` y `VITE_SUPABASE_KEY` con los mismos valores del `.env`.
4. Desplegá y abrí la URL pública que te da Vercel.

## Qué hay en cada archivo

- `src/supabase.js`: conexión con Supabase.
- `src/App.jsx`: consulta de la tabla `esquinas`, indicadores, mapa con deck.gl (columnas 3D y etiquetas), ranking y panel de detalle.
- `src/styles.css`: estilos.
