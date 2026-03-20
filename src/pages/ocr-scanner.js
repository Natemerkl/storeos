import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { navigate } from '../router.js'
import { consumePendingScan } from '../components/mobile-nav.js'

export async function render(container) {
  const { currentStore } = appStore.getState()

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Scan Receipt</div>
        <div class="page-sub">Upload or photograph any receipt, invoice or document</div>
      </div>
    </div>

    <!-- Upload zone -->
    <div class="card" style="margin-bottom:1rem">
      <div id="drop-zone" style="
        border: 2px dashed var(--border);
        border-radius: var(--radius);
        padding: 3rem 2rem;
        text-align: center;
        cursor: pointer;
        transition: all 0.2s;
      ">
        <div style="font-size:2.5rem;margin-bottom:0.75rem">⊙</div>
        <div style="font-weight:600;font-size:1rem;margin-bottom:0.4rem">Drop a file here or click to upload</div>
        <div style="color:var(--muted);font-size:13px">Supports JPG, PNG, PDF — max 10MB</div>
        <input type="file" id="file-input" accept="image/*,.pdf" style="display:none">
      </div>

      <div style="display:flex;align-items:center;gap:1rem;margin:1rem 0">
        <hr style="flex:1;border:none;border-top:1px solid var(--border)">
        <span style="color:var(--muted);font-size:13px">or</span>
        <hr style="flex:1;border:none;border-top:1px solid var(--border)">
      </div>

      <div style="text-align:center">
        <button class="btn btn-outline" id="btn-camera">📷 Use Camera</button>
      </div>

      <!-- Camera preview -->
      <div id="camera-section" style="display:none;margin-top:1rem">
        <video id="camera-preview" autoplay playsinline style="width:100%;max-height:340px;border-radius:var(--radius);background:#000"></video>
        <div style="display:flex;gap:0.75rem;justify-content:center;margin-top:0.75rem">
          <button class="btn btn-primary" id="btn-capture">📸 Capture</button>
          <button class="btn btn-outline" id="btn-camera-close">Cancel</button>
        </div>
        <canvas id="capture-canvas" style="display:none"></canvas>
      </div>

      <!-- Preview -->
      <div id="preview-section" style="display:none;margin-top:1rem">
        <img id="preview-img" style="max-width:100%;max-height:340px;border-radius:var(--radius);display:block;margin:0 auto">
        <div style="display:flex;gap:0.75rem;justify-content:center;margin-top:0.75rem">
          <button class="btn btn-primary" id="btn-scan">⊙ Scan with AI</button>
          <button class="btn btn-outline" id="btn-clear-preview">✕ Clear</button>
        </div>
      </div>

      <!-- Progress -->
      <div id="progress-section" style="display:none;margin-top:1rem;text-align:center">
        <div style="font-size:1.5rem;margin-bottom:0.5rem">⏳</div>
        <div id="progress-text" style="color:var(--muted);font-size:13.5px">Uploading...</div>
      </div>
    </div>

    <!-- Recent scans -->
    <div class="card">
      <div style="font-weight:600;margin-bottom:1rem">Recent Scans</div>
      <div id="recent-scans">Loading...</div>
    </div>
  `

  let selectedFile = null
  let cameraStream = null

  // ── Drop zone ──────────────────────────────────────────────
  const dropZone  = container.querySelector('#drop-zone')
  const fileInput = container.querySelector('#file-input')

  dropZone.addEventListener('click', () => fileInput.click())
  dropZone.addEventListener('dragover', e => {
    e.preventDefault()
    dropZone.style.borderColor = 'var(--accent)'
    dropZone.style.background  = 'var(--accent-lt)'
  })
  dropZone.addEventListener('dragleave', () => {
    dropZone.style.borderColor = 'var(--border)'
    dropZone.style.background  = ''
  })
  dropZone.addEventListener('drop', e => {
    e.preventDefault()
    dropZone.style.borderColor = 'var(--border)'
    dropZone.style.background  = ''
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  })
  fileInput.addEventListener('change', e => {
    if (e.target.files[0]) handleFile(e.target.files[0])
  })

  // ── Camera ─────────────────────────────────────────────────
  container.querySelector('#btn-camera').addEventListener('click', async () => {
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      container.querySelector('#camera-preview').srcObject = cameraStream
      container.querySelector('#camera-section').style.display = 'block'
      container.querySelector('#btn-camera').style.display = 'none'
    } catch (err) {
      alert('Camera not available. Please upload a file instead.')
    }
  })

  container.querySelector('#btn-camera-close').addEventListener('click', stopCamera)
  container.querySelector('#btn-capture').addEventListener('click', () => {
    const video  = container.querySelector('#camera-preview')
    const canvas = container.querySelector('#capture-canvas')
    canvas.width  = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    canvas.toBlob(blob => {
      const file = new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' })
      stopCamera()
      handleFile(file)
    }, 'image/jpeg', 0.85)
  })

  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop())
      cameraStream = null
    }
    container.querySelector('#camera-section').style.display = 'none'
    container.querySelector('#btn-camera').style.display     = 'inline-flex'
  }

  // ── File handler ───────────────────────────────────────────
  function handleFile(file) {
    if (file.size > 10 * 1024 * 1024) { alert('File too large. Max 10MB.'); return }
    selectedFile = file

    const reader = new FileReader()
    reader.onload = e => {
      container.querySelector('#preview-img').src = e.target.result
      container.querySelector('#preview-section').style.display = 'block'
      dropZone.style.display = 'none'
    }
    reader.readAsDataURL(file)
  }

  container.querySelector('#btn-clear-preview').addEventListener('click', () => {
    selectedFile = null
    container.querySelector('#preview-section').style.display = 'none'
    dropZone.style.display = 'block'
    fileInput.value = ''
  })

  // ── Scan ───────────────────────────────────────────────────
  container.querySelector('#btn-scan').addEventListener('click', async () => {
    if (!selectedFile) return

    showProgress('Uploading receipt...')

    try {
      // 1. Compress image
      const compressed = await compressImage(selectedFile)

      // 2. Upload to Supabase Storage
      const fileName  = `${currentStore?.id}/${Date.now()}-${selectedFile.name}`
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('receipts')
        .upload(fileName, compressed, { contentType: selectedFile.type })

      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage.from('receipts').getPublicUrl(fileName)

      showProgress('AI is reading your document...')

      // 3. Call OCR Edge Function
      const { data: ocrResult, error: ocrError } = await supabase.functions.invoke('ocr-proxy', {
  body: { 
    imageUrl: publicUrl,
    storeId:  currentStore?.id  // add this
  }
})

// Handle rate limit
if (ocrError || ocrResult?.error === 'rate_limit_exceeded') {
  hideProgress()
  alert(`⚠️ ${ocrResult?.message || 'Scan failed'}`)
  return
}

      // 4. Save OCR log
      const { data: logData, error: logError } = await supabase
        .from('ocr_logs')
        .insert({
          store_id:      currentStore?.id,
          image_url:     publicUrl,
          raw_text:      ocrResult.raw_text      || '',
          raw_blocks:    ocrResult.raw_blocks    || {},
          parsed_data:   ocrResult.parsed_data   || {},
          status:        'pending',
        })
        .select()
        .single()

      if (logError) throw logError

      // 5. Navigate to review editor
      sessionStorage.setItem('ocr_log_id', logData.id)
      navigate('/ocr/review')

    } catch (err) {
      console.error('OCR error:', err)
      hideProgress()

      // Fallback — save with raw text only and go to editor
      alert('AI scan failed — opening manual review mode. You can still edit and apply the data.')
      const { data: logData } = await supabase.from('ocr_logs').insert({
        store_id:    currentStore?.id,
        image_url:   '',
        raw_text:    'OCR failed — please enter data manually',
        parsed_data: {},
        status:      'pending',
      }).select().single()

      if (logData) {
        sessionStorage.setItem('ocr_log_id', logData.id)
        navigate('/ocr/review')
      }
    }
  })

  function showProgress(text) {
    container.querySelector('#preview-section').style.display  = 'none'
    container.querySelector('#progress-section').style.display = 'block'
    container.querySelector('#progress-text').textContent      = text
  }

  function hideProgress() {
    container.querySelector('#progress-section').style.display = 'none'
    container.querySelector('#preview-section').style.display  = 'block'
  }

  // ── Compress image ─────────────────────────────────────────
  async function compressImage(file) {
    if (file.type === 'application/pdf') return file
    return new Promise(resolve => {
      const img    = new Image()
      const reader = new FileReader()
      reader.onload = e => {
        img.onload = () => {
          const canvas = document.createElement('canvas')
          const MAX    = 1200
          let   w = img.width, h = img.height
          if (w > MAX) { h = Math.round(h * MAX / w); w = MAX }
          if (h > MAX) { w = Math.round(w * MAX / h); h = MAX }
          canvas.width = w; canvas.height = h
          canvas.getContext('2d').drawImage(img, 0, 0, w, h)
          canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.82)
        }
        img.src = e.target.result
      }
      reader.readAsDataURL(file)
    })
  }

  // ── Recent scans ───────────────────────────────────────────
  async function loadRecentScans() {
    const { data, error } = await supabase
      .from('ocr_logs')
      .select('*')
      .eq('store_id', currentStore?.id)
      .order('created_at', { ascending: false })
      .limit(10)

    const el = container.querySelector('#recent-scans')
    if (error || !data || data.length === 0) {
      el.innerHTML = `<div class="empty"><div class="empty-text">No scans yet</div></div>`
      return
    }

    el.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Status</th>
              <th>Document Type</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${data.map(log => `
              <tr>
                <td>${new Date(log.created_at).toLocaleDateString()}</td>
                <td>
                  <span class="badge ${
                    log.status === 'applied'   ? 'badge-green' :
                    log.status === 'pending'   ? 'badge-yellow' :
                    log.status === 'discarded' ? 'badge-grey' : 'badge-teal'
                  }">${log.status}</span>
                </td>
                <td>${log.document_type || '—'}</td>
                <td>
                  ${log.status !== 'applied' ? `
                    <button class="btn btn-outline btn-sm" data-id="${log.id}" data-action="review">
                      Review
                    </button>
                  ` : ''}
                  ${log.image_url ? `
                    <a href="${log.image_url}" target="_blank" class="btn btn-outline btn-sm">View</a>
                  ` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `

    el.querySelectorAll('[data-action="review"]').forEach(btn => {
      btn.addEventListener('click', () => {
        sessionStorage.setItem('ocr_log_id', btn.dataset.id)
        navigate('/ocr/review')
      })
    })
  }

  await loadRecentScans()

  // After all event listeners are set up, check for pending FAB scan
  const pendingFile = consumePendingScan()
  if (pendingFile) {
    // Small delay so UI renders first
    setTimeout(() => handleFile(pendingFile), 300)
  }
}