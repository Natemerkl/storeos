import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession:     true,
    autoRefreshToken:   true,
    detectSessionInUrl: true,
    storageKey:         'storeos-auth',
    lock: (name, acquireTimeout, fn) => fn(), // bypass lock mechanism
  },
  global: {
    headers: { 'x-app-name': 'storeos' }
  }
})

window._supabase = supabase