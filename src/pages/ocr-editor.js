import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { navigate } from '../router.js'
import { openSmartOCRModal } from '../components/smart-ocr-modal.js'

export async function render(container) {
  const logId = sessionStorage.getItem('ocr_log_id')

  if (!logId) {
    container.innerHTML = `
      <div class="empty" style="margin-top:4rem">
        <div class="empty-icon">⊙</div>
        <div class="empty-text">No scan to review.</div>
        <button class="btn btn-primary" style="margin-top:1rem" id="btn-back">← Back to Scanner</button>
      </div>
    `
    container.querySelector('#btn-back').addEventListener('click', () => navigate('/ocr'))
    return
  }

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:60vh">
      <div style="text-align:center">
        <div style="font-size:2rem;margin-bottom:0.75rem">⊙</div>
        <div style="font-weight:600;margin-bottom:0.4rem">Loading scan...</div>
        <div style="color:var(--muted);font-size:13px">Preparing smart review</div>
      </div>
    </div>
  `

  const { data: log, error } = await supabase
    .from('ocr_logs')
    .select('*')
    .eq('id', logId)
    .single()

  if (error || !log) {
    container.innerHTML = `<div class="empty"><div class="empty-text">Scan not found.</div></div>`
    return
  }

  // Open smart modal immediately
  openSmartOCRModal(log, () => {
    navigate('/dashboard')
  })
}