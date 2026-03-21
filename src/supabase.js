import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession:     true,
    autoRefreshToken:   true,
    detectSessionInUrl: true,
    storageKey:         'storeos-auth',
    lock: (name, acquireTimeout, fn) => fn(),
  }
  // REMOVED: global headers — x-app-name causes CORS block on Edge Functions
})

window._supabase = supabase