import { createClient } from '@supabase/supabase-js'
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_KEY
export const faltanClaves = !url || !key
export const supabase = createClient(url || 'https://placeholder.supabase.co', key || 'placeholder')
