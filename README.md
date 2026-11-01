# Congestión en Av. Perón · semáforos y desvíos (PoC georreferenciada)
React + Vite + deck.gl + Supabase.

1. Supabase → SQL Editor → pegar y ejecutar `data/supabase_congestion.sql` (crea las tablas `congestion`, `paradas` y `desvios`, con lectura pública).
2. Reemplazar en tu proyecto `src/App.jsx` y `src/styles.css` por los de esta carpeta (el resto queda igual; el `.env` no cambia).
3. `npm run dev`. Para publicar: subir a GitHub; Vercel lo despliega solo.

Para regenerar el SQL con otro Excel: `python data/generar_sql.py` (lee `data/PuntoIdeal_modelo_v10.xlsx`).
