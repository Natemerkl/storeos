import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { navigate } from '../router.js'
import { renderIcon } from '../components/icons.js'

export async function render(container) {
  container.style.width = '100%'

  let isSignUp = false

  // Check for saved email
  const savedEmail = localStorage.getItem('storeos-saved-email') || ''
  const rememberMe = localStorage.getItem('storeos-remember') === 'true'

  container.innerHTML = `
    <div style="
      min-height:100vh;
      background:linear-gradient(160deg,#E8F5F3 0%,#F3F9F8 35%,#F8FAFC 65%,#EEF2FF 100%);
      display:flex;align-items:center;justify-content:center;
      padding:1rem;font-family:var(--font);
    ">
      <div style="width:100%;max-width:400px">

        <!-- Logo -->
        <div style="text-align:center;margin-bottom:2rem">
          <div style="
            display:inline-flex;align-items:center;gap:0.5rem;
            font-size:1.75rem;font-weight:800;color:var(--dark);letter-spacing:-0.5px;
          ">
            <div style="
              width:40px;height:40px;background:var(--accent);border-radius:12px;
              display:flex;align-items:center;justify-content:center;
            ">${renderIcon('store', 20, '#fff')}</div>
            Store<span style="color:var(--accent)">OS</span>
          </div>
          <div style="color:var(--muted);font-size:0.9375rem;margin-top:0.5rem" id="auth-subtitle">
            Sign in to your account
          </div>
        </div>

        <!-- Card -->
        <div style="
          background:#fff;border-radius:24px;padding:2rem;
          box-shadow:0 4px 24px rgba(0,0,0,0.07);border:1px solid var(--border);
        ">
          <!-- Error banner -->
          <div id="auth-error" style="
            display:none;
            background:var(--red-50);color:#991B1B;
            border:1px solid #FECACA;border-radius:var(--radius);
            padding:0.75rem 1rem;font-size:0.875rem;
            margin-bottom:1rem;
            align-items:center;gap:0.5rem;
          ">
            ${renderIcon('alert', 15, '#991B1B')}
            <span id="auth-error-text"></span>
          </div>

          <div class="form-group">
            <label class="form-label">Email address</label>
            <input
              class="form-input"
              id="auth-email"
              type="email"
              placeholder="you@example.com"
              autocomplete="email"
              value="${savedEmail}"
              style="font-size:1rem"
            >
          </div>

          <div class="form-group">
            <label class="form-label">Password</label>
            <div style="position:relative">
              <input
                class="form-input"
                id="auth-password"
                type="password"
                placeholder="••••••••"
                autocomplete="current-password"
                style="font-size:1rem;padding-right:2.75rem"
              >
              <button id="toggle-password" style="
                position:absolute;right:0.75rem;top:50%;transform:translateY(-50%);
                color:var(--muted);display:flex;align-items:center;
              " type="button">${renderIcon('scan', 16)}</button>
            </div>
          </div>

          <!-- Remember me -->
          <div id="remember-row" style="
            display:flex;align-items:center;justify-content:space-between;
            margin-bottom:1.25rem;
          ">
            <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;font-size:0.875rem;color:var(--muted)">
              <input
                type="checkbox"
                id="remember-me"
                ${rememberMe ? 'checked' : ''}
                style="width:16px;height:16px;accent-color:var(--accent);cursor:pointer"
              >
              Remember me
            </label>
            <button id="btn-forgot" style="
              font-size:0.8125rem;color:var(--accent);font-weight:500;
              background:none;border:none;cursor:pointer;padding:0;
            ">Forgot password?</button>
          </div>

          <!-- Submit -->
          <button
            class="btn btn-primary"
            id="btn-auth"
            style="width:100%;justify-content:center;padding:0.75rem;font-size:1rem;border-radius:14px"
          >
            Sign In
          </button>

          <div style="
            display:flex;align-items:center;gap:0.75rem;margin:1.25rem 0;
          ">
            <div style="flex:1;height:1px;background:var(--border)"></div>
            <span style="font-size:0.8125rem;color:var(--muted)">or</span>
            <div style="flex:1;height:1px;background:var(--border)"></div>
          </div>

          <div style="text-align:center">
            <span style="font-size:0.875rem;color:var(--muted)" id="toggle-label">
              Don't have an account?
            </span>
            <button
              class="btn btn-ghost btn-sm"
              id="btn-toggle"
              style="color:var(--accent);font-weight:600;padding:0 0.25rem"
            >
              Sign Up
            </button>
          </div>
        </div>

        <!-- Forgot password panel (hidden by default) -->
        <div id="forgot-panel" style="
          display:none;
          background:#fff;border-radius:24px;padding:1.5rem;
          box-shadow:0 4px 24px rgba(0,0,0,0.07);border:1px solid var(--border);
          margin-top:1rem;
        ">
          <div style="font-weight:700;margin-bottom:0.5rem">Reset Password</div>
          <div style="font-size:0.875rem;color:var(--muted);margin-bottom:1rem">
            Enter your email and we'll send a reset link.
          </div>
          <div style="display:flex;gap:0.5rem">
            <input class="form-input" id="reset-email"
              type="email" placeholder="your@email.com" style="flex:1">
            <button class="btn btn-primary" id="btn-reset">Send</button>
          </div>
          <div id="reset-status" style="font-size:0.8125rem;margin-top:0.5rem;display:none"></div>
        </div>

        <div style="text-align:center;margin-top:1.5rem;font-size:0.8125rem;color:var(--muted)">
          Secure · Encrypted · Your data stays yours
        </div>
      </div>
    </div>
  `

  // ── Toggle sign in / sign up ─────────────────────────────
  container.querySelector('#btn-toggle').addEventListener('click', () => {
    isSignUp = !isSignUp
    container.querySelector('#auth-subtitle').textContent = isSignUp ? 'Create your account' : 'Sign in to your account'
    container.querySelector('#btn-auth').textContent      = isSignUp ? 'Create Account' : 'Sign In'
    container.querySelector('#toggle-label').textContent  = isSignUp ? 'Already have an account?' : "Don't have an account?"
    container.querySelector('#btn-toggle').textContent    = isSignUp ? 'Sign In' : 'Sign Up'
    container.querySelector('#remember-row').style.display = isSignUp ? 'none' : 'flex'
    container.querySelector('#forgot-panel').style.display = 'none'
    hideError()
  })

  // ── Password visibility ──────────────────────────────────
  container.querySelector('#toggle-password').addEventListener('click', () => {
    const input = container.querySelector('#auth-password')
    input.type  = input.type === 'password' ? 'text' : 'password'
  })

  // ── Forgot password ──────────────────────────────────────
  container.querySelector('#btn-forgot').addEventListener('click', () => {
    const panel = container.querySelector('#forgot-panel')
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none'
    const email = container.querySelector('#auth-email').value
    if (email) container.querySelector('#reset-email').value = email
  })

  container.querySelector('#btn-reset').addEventListener('click', async () => {
    const email     = container.querySelector('#reset-email').value.trim()
    const statusEl  = container.querySelector('#reset-status')
    const btn       = container.querySelector('#btn-reset')
    if (!email) return

    btn.textContent  = 'Sending...'
    btn.disabled     = true

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth`
    })

    statusEl.style.display = 'block'
    if (error) {
      statusEl.style.color   = 'var(--danger)'
      statusEl.textContent   = error.message
    } else {
      statusEl.style.color   = 'var(--accent)'
      statusEl.textContent   = '✓ Reset link sent — check your email'
    }
    btn.textContent = 'Send'
    btn.disabled    = false
  })

  // ── Error helpers ────────────────────────────────────────
  function showError(msg) {
    const el   = container.querySelector('#auth-error')
    const text = container.querySelector('#auth-error-text')
    if (el && text) { text.textContent = msg; el.style.display = 'flex' }
  }

  function hideError() {
    const el = container.querySelector('#auth-error')
    if (el) el.style.display = 'none'
  }

  // ── Submit ───────────────────────────────────────────────
  async function handleAuth() {
    const email    = container.querySelector('#auth-email').value.trim()
    const password = container.querySelector('#auth-password').value
    const remember = container.querySelector('#remember-me')?.checked
    const btn      = container.querySelector('#btn-auth')

    if (!email)              { showError('Please enter your email');    return }
    if (!password)           { showError('Please enter your password'); return }
    if (password.length < 6) { showError('Password must be at least 6 characters'); return }

    btn.textContent = isSignUp ? 'Creating account...' : 'Signing in...'
    btn.disabled    = true
    hideError()

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        appStore.getState().setUser(data.user)
        navigate('/onboarding')

      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error

        // Save remember me preference
        if (remember) {
          localStorage.setItem('storeos-saved-email', email)
          localStorage.setItem('storeos-remember', 'true')
        } else {
          localStorage.removeItem('storeos-saved-email')
          localStorage.setItem('storeos-remember', 'false')
        }

        appStore.getState().setUser(data.user)

        // Check stores
        const { data: owner } = await supabase
          .from('owners').select('id').eq('email', email).single()

        if (!owner) { navigate('/onboarding'); return }

        const { data: stores } = await supabase
          .from('stores').select('*').eq('owner_id', owner.id)

        if (!stores || stores.length === 0) { navigate('/onboarding'); return }

        appStore.getState().setStores(stores)
        appStore.getState().setCurrentStore(stores[0])
        navigate('/dashboard')
      }

    } catch(err) {
      showError(
        err.message === 'Invalid login credentials'
          ? 'Wrong email or password. Please try again.'
          : err.message
      )
    } finally {
      btn.textContent = isSignUp ? 'Create Account' : 'Sign In'
      btn.disabled    = false
    }
  }

  container.querySelector('#btn-auth').addEventListener('click', handleAuth)
  container.querySelectorAll('#auth-email, #auth-password').forEach(input => {
    input.addEventListener('keydown', e => { if (e.key === 'Enter') handleAuth() })
  })

  // Auto focus — skip if email pre-filled
  setTimeout(() => {
    if (savedEmail) {
      container.querySelector('#auth-password')?.focus()
    } else {
      container.querySelector('#auth-email')?.focus()
    }
  }, 100)
}