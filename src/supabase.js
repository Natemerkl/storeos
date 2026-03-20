import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession:    true,       // keeps session in localStorage
    autoRefreshToken:  true,       // auto-refreshes before expiry
    detectSessionInUrl: true,      // handles magic links + reset links
    storageKey: 'storeos-auth',    // unique key so it doesn't clash
  },
  realtime: { enabled: false },    // disable realtime to kill lock warnings
})

window._supabase = supabase