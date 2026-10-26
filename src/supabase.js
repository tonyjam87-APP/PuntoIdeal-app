import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_KEY

export const faltanClaves = !url || !key

// Si faltan las claves usamos valores de relleno para que la app no se rompa;
// en ese caso la pantalla muestra un aviso en lugar del mapa.
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  key || 'placeholder'
)
