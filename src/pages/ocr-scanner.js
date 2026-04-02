import { supabase } from '../supabase.js'
import { appStore } from '../store.js'
import { navigate } from '../router.js'
import { renderIcon } from '../components/icons.js'
import { openSmartOCRModal } from '../components/smart-ocr-modal.js'
import { consumePendingScan } from '../components/mobile-nav.js'
import { getInventory, getCustomers } from '../utils/db.js'

export async function render(container) {
  const { currentStore } = appStore.getState()

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Scan Receipt</div>
        <div class="page-sub">Upload or photograph any receipt, invoice or document</div>
      </div>
    </div>

    <!-- Upload card -->
    <div class="card" style="margin-bottom:1.25rem">

      <!-- ── Scan Mode Toggle ───────────────────────────────── -->
      <div style="
        display:flex;align-items:center;justify-content:space-between;
        padding:0.75rem 1rem;
        background:var(--bg-subtle);
        border-radius:var(--radius-lg);
        margin-bottom:1.25rem;
        border:1.5px solid var(--border);
      ">
        <div>
          <div style="font-weight:700;font-size:0.9375rem;color:var(--dark)" id="scan-mode-label">
            Standard Scan
          </div>
          <div style="font-size:0.75rem;color:var(--muted);margin-top:2px" id="scan-mode-sub">
            Fast · Google Vision · Editable columns
          </div>
        </div>

        <!-- Toggle pill -->
        <button id="scan-mode-toggle" aria-pressed="false" aria-label="Toggle Pro Scan mode" style="
          display:flex;align-items:center;gap:0.625rem;
          padding:0.4rem 0.875rem 0.4rem 0.5rem;
          background:var(--bg-elevated);
          border:1.5px solid var(--border);
          border-radius:var(--radius-pill);
          cursor:pointer;transition:all 0.2s;
          font-size:0.8125rem;font-weight:600;
          color:var(--muted);
          -webkit-tap-highlight-color:transparent;
        ">
          <div id="scan-mode-pip" style="
            width:20px;height:20px;border-radius:50%;
            background:var(--gray-300);
            display:flex;align-items:center;justify-content:center;
            transition:all 0.2s;flex-shrink:0;
          ">
            ${renderIcon('zap', 11, '#fff')}
          </div>
          <span id="scan-mode-toggle-label">Pro Scan</span>
        </button>
      </div>

      <!-- Drop zone -->
      <div id="drop-zone" style="
        border:2px dashed var(--border);
        border-radius:var(--radius-lg);
        padding:3rem 2rem;
        text-align:center;
        cursor:pointer;
        transition:all 0.2s;
        background:var(--bg-subtle);
      ">
        <div style="
          width:56px;height:56px;
          background:var(--teal-50);border-radius:16px;
          display:flex;align-items:center;justify-content:center;
          margin:0 auto 1rem;
          color:var(--accent);
        ">
          ${renderIcon('scan', 26, 'var(--accent)')}
        </div>
        <div style="font-weight:600;font-size:1rem;margin-bottom:0.4rem;color:var(--dark)">
          Drop a file here or click to upload
        </div>
        <div style="color:var(--muted);font-size:0.8125rem">
          Supports JPG, PNG, WebP, PDF — max 10MB
        </div>
        <input type="file" id="file-input" accept="image/*,.pdf" style="display:none">
      </div>

      <!-- Divider -->
      <div style="display:flex;align-items:center;gap:1rem;margin:1.25rem 0">
        <div style="flex:1;height:1px;background:var(--border)"></div>
        <span style="color:var(--muted);font-size:0.8125rem;font-weight:500">or</span>
        <div style="flex:1;height:1px;background:var(--border)"></div>
      </div>

      <!-- Camera button -->
      <div style="text-align:center">
        <button class="btn btn-outline" id="btn-camera" style="gap:0.5rem">
          ${renderIcon('scan', 16)} Use Camera
        </button>
      </div>

      <!-- Camera preview -->
      <div id="camera-section" style="display:none;margin-top:1.25rem">
        <video id="camera-preview" autoplay playsinline
          style="width:100%;max-height:360px;border-radius:var(--radius-lg);background:#000;display:block">
        </video>
        <div style="display:flex;gap:0.75rem;justify-content:center;margin-top:0.875rem">
          <button class="btn btn-primary" id="btn-capture" style="gap:0.5rem">
            ${renderIcon('scan', 16)} Capture
          </button>
          <button class="btn btn-outline" id="btn-camera-close">Cancel</button>
        </div>
        <canvas id="capture-canvas" style="display:none"></canvas>
      </div>

      <!-- Preview -->
      <div id="preview-section" style="display:none;margin-top:1.25rem">
        <div style="
          border-radius:var(--radius-lg);overflow:hidden;
          background:var(--bg-subtle);
          max-height:360px;display:flex;align-items:center;justify-content:center;
        ">
          <img id="preview-img" style="
            max-width:100%;max-height:360px;
            object-fit:contain;display:block;
          ">
        </div>
        <div style="display:flex;gap:0.75rem;justify-content:center;margin-top:0.875rem">
          <button class="btn btn-primary" id="btn-scan" style="gap:0.5rem">
            ${renderIcon('scan', 16)} Scan with AI
          </button>
          <button class="btn btn-outline" id="btn-clear-preview" style="gap:0.375rem">
            ${renderIcon('close', 14)} Clear
          </button>
        </div>
      </div>

      <!-- Progress -->
      <div id="progress-section" style="display:none;margin-top:1.25rem;text-align:center;padding:1rem 0">
        <div style="
          width:48px;height:48px;
          border:3px solid var(--border);
          border-top-color:var(--accent);
          border-radius:50%;
          animation:spin 0.8s linear infinite;
          margin:0 auto 1rem;
        "></div>
        <div id="progress-text" style="
          color:var(--muted);font-size:0.9375rem;font-weight:500
        ">Uploading...</div>
        <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
      </div>

    </div>

    <!-- Recent scans -->
    <div class="card">
      <div style="font-weight:700;font-size:0.9375rem;margin-bottom:1rem">Recent Scans</div>
      <div id="recent-scans">
        <!-- Skeleton -->
        <div style="display:flex;flex-direction:column;gap:0.5rem">
          ${[1,2,3].map(() => `
            <div class="skeleton" style="height:44px;border-radius:var(--radius)"></div>
          `).join('')}
        </div>
      </div>
    </div>
  `

  // ── State ────────────────────────────────────────────────
  let selectedFile  = null
  let cameraStream  = null
  let isScanning    = false
  let scanMode      = localStorage.getItem('storeos-scan-mode') || 'standard' // 'standard' | 'pro'

  // Apply initial mode UI
  applyScanModeUI()

  // ── Consume pending scan from FAB camera ───────────────
  setTimeout(() => {
    const pending = consumePendingScan()
    if (pending) handleFile(pending)
  }, 100)

  // ── Scan Mode Toggle ───────────────────────────────────
  function applyScanModeUI() {
    const isPro    = scanMode === 'pro'
    const label    = container.querySelector('#scan-mode-label')
    const sub      = container.querySelector('#scan-mode-sub')
    const pip      = container.querySelector('#scan-mode-pip')
    const toggle   = container.querySelector('#scan-mode-toggle')
    const tLabel   = container.querySelector('#scan-mode-toggle-label')

    if (label) label.textContent = isPro ? 'Pro Scan (AI Auto-Correct)' : 'Standard Scan'
    if (sub) sub.textContent = isPro
      ? 'Gemini 1.5 Flash · Auto-matched · No correction needed'
      : 'Fast · Google Vision · Editable columns'
    if (pip) pip.style.background = isPro ? 'var(--accent)' : 'var(--gray-300)'
    if (toggle) {
      toggle.style.borderColor = isPro ? 'var(--accent)' : 'var(--border)'
      toggle.style.color = isPro ? 'var(--accent)' : 'var(--muted)'
      toggle.setAttribute('aria-pressed', isPro ? 'true' : 'false')
    }
    if (tLabel) tLabel.textContent = isPro ? 'Pro Active' : 'Pro Scan'
  }

  container.querySelector('#scan-mode-toggle').addEventListener('click', () => {
    scanMode = scanMode === 'standard' ? 'pro' : 'standard'
    localStorage.setItem('storeos-scan-mode', scanMode)
    applyScanModeUI()
    if (navigator.vibrate) navigator.vibrate(6)
  })

  // ── Drop zone ──────────────────────────────────────────
  const dropZone  = container.querySelector('#drop-zone')
  const fileInput = container.querySelector('#file-input')

  dropZone.addEventListener('click', () => fileInput.click())

  dropZone.addEventListener('dragover', e => {
    e.preventDefault()
    dropZone.style.borderColor = 'var(--accent)'
    dropZone.style.background  = 'var(--teal-50)'
  })

  dropZone.addEventListener('dragleave', () => {
    dropZone.style.borderColor = 'var(--border)'
    dropZone.style.background  = 'var(--bg-subtle)'
  })

  dropZone.addEventListener('drop', e => {
    e.preventDefault()
    dropZone.style.borderColor = 'var(--border)'
    dropZone.style.background  = 'var(--bg-subtle)'
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  })

  fileInput.addEventListener('change', e => {
    if (e.target.files[0]) handleFile(e.target.files[0])
  })

  // ── Camera ─────────────────────────────────────────────
  container.querySelector('#btn-camera').addEventListener('click', async () => {
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      })
      container.querySelector('#camera-preview').srcObject = cameraStream
      container.querySelector('#camera-section').style.display = 'block'
      container.querySelector('#btn-camera').style.display     = 'none'
      dropZone.style.display = 'none'
    } catch(err) {
      showToast('Camera not available — please upload a file instead', 'error')
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
      const file = new File([blob], `scan-${Date.now()}.jpg`, { type: 'image/jpeg' })
      stopCamera()
      handleFile(file)
    }, 'image/jpeg', 0.88)
  })

  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop())
      cameraStream = null
    }
    container.querySelector('#camera-section').style.display = 'none'
    container.querySelector('#btn-camera').style.display     = ''
    dropZone.style.display = 'block'
  }

  // ── File handler ───────────────────────────────────────
  function handleFile(file) {
    if (file.size > 10 * 1024 * 1024) {
      showToast('File too large — max 10MB', 'error')
      return
    }
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
    isScanning   = false
    container.querySelector('#preview-section').style.display  = 'none'
    container.querySelector('#progress-section').style.display = 'none'
    dropZone.style.display = 'block'
    fileInput.value = ''
  })

  // ── Scan ───────────────────────────────────────────────
  container.querySelector('#btn-scan').addEventListener('click', async () => {
    if (!selectedFile || isScanning) return
    isScanning = true
    await doScan()
    isScanning = false
  })

  // ── Fetch user context for Pro Mode ───────────────────
  async function fetchUserContext() {
    try {
      const [inventory, customers] = await Promise.all([
        getInventory(),
        getCustomers(),
      ])
      return {
        products:  (inventory || []).map(i => ({
          id:    i.id,
          name:  i.item_name,
          price: i.selling_price || i.unit_cost || 0,
          sku:   i.sku || '',
        })).slice(0, 150),   // cap at 150 to stay within token budget
        customers: (customers || []).map(c => ({
          id:    c.id,
          name:  c.name,
          phone: c.phone || '',
        })).slice(0, 80),
      }
    } catch(err) {
      console.warn('fetchUserContext failed:', err.message)
      return { products: [], customers: [] }
    }
  }

  // ── Merge top-level OCR response fields into parsed_data before saving ──────
  // processFinalFlow only stores parsed_data; customer_header/transport/payment_bank
  // live at the top level of the OCR response and must be merged in here.
  function enrichOcrResult(parsedData, fullResult) {
    return {
      ...parsedData,
      customer_header: fullResult.customer_header || parsedData.customer_header || null,
      transport:       fullResult.transport       || parsedData.transport       || null,
      payment_bank:    fullResult.payment_bank    || parsedData.payment_bank    || null,
      validation:      fullResult.validation      || parsedData.validation      || null,
    }
  }

  // ── Main scan flow ────────────────────────────────────
  async function doScan() {
    const isPro = scanMode === 'pro'
    showProgress(isPro ? 'Preparing AI scan...' : 'Uploading receipt...')

    try {
      // 1. Compress image (Phase 1: aggressive client-side compression)
      const compressed = await compressImage(selectedFile)

      // 2. Upload to Supabase Storage
      const ext      = (selectedFile.name.split('.').pop() || 'jpg').toLowerCase()
      const fileName = `${currentStore?.id || 'scan'}/${Date.now()}.${ext === 'pdf' ? 'pdf' : 'webp'}` 

      const { error: uploadError } = await supabase.storage
        .from('receipts')
        .upload(fileName, compressed, {
          contentType: ext === 'pdf' ? 'application/pdf' : 'image/webp',
          upsert: false,
        })

      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage
        .from('receipts').getPublicUrl(fileName)

      // 3. Fetch user context for Pro Mode (parallel with upload would be ideal but upload must be first)
      let userContext = { products: [], customers: [] }
      if (isPro) {
        showProgress('Fetching store context...')
        userContext = await fetchUserContext()
      }

      showProgress(isPro ? 'Gemini AI is reading your document...' : 'AI is reading your document...')

      // 4. Call OCR Edge Function with mode + context
      const { data: ocrResult, error: ocrError } = await supabase.functions.invoke('ocr-proxy', {
        body: {
          imageUrl:    publicUrl,
          storeId:     currentStore?.id || 'onboarding',
          mode:        scanMode,                 // 'standard' | 'pro'
          userContext: isPro ? userContext : undefined,
        }
      })

      if (ocrError) throw new Error(ocrError.message || 'OCR failed')
      if (ocrResult?.error) throw new Error(ocrResult.error)

      console.log('[DEBUG] Raw Edge Function Response:', ocrResult)

      // Warn if Pro scan fell back to Vision (GEMINI_API_KEY missing or Gemini error)
      if (ocrResult?.parsed_data?.fallback_from_pro) {
        showToast('⚠️ Pro scan fell back to Standard mode — check that GEMINI_API_KEY is set in Supabase secrets.', 'warning')
      }

      // 5. Route based on mode and result flags
      if (isPro) {
        // Pro Mode: skip column correction, go straight to smart modal
        const enrichedPro = enrichOcrResult(ocrResult.parsed_data, ocrResult)
        console.log('[DEBUG] Enriched parsed_data going to DB:', enrichedPro)
        await processFinalFlow(enrichedPro, ocrResult.id, publicUrl)
      } else {
        // Standard Mode: check if column correction is needed
        const parsedData = ocrResult?.parsed_data || { line_items: [] }
        const logId      = ocrResult?.id

        if (parsedData.column_detection?.needs_review) {
          hideProgress()
          const { openColumnCorrectionModal } = await import('../components/column-correction-modal.js')
          openColumnCorrectionModal({
            imageUrl:       publicUrl,
            columns:        parsedData.column_detection.columns,
            rawText:        ocrResult.raw_text,
            customerHeader: ocrResult.customer_header || {},
            transport:      ocrResult.transport       || null,
            onSave: async (orderedTypes, confirmedHeader, manualTransportFee) => {
              showProgress('Re-processing with corrected columns...')
              try {
                const { data: finalResult, error: finalError } = await supabase.functions.invoke('ocr-proxy', {
                  body: {
                    imageUrl:            publicUrl,
                    storeId:             currentStore?.id || 'onboarding',
                    mode:                'standard',
                    manual_column_order: orderedTypes,
                  }
                })
                if (finalError) throw new Error(finalError.message)
                if (finalResult?.error) throw new Error(finalResult.error)
                const retryData = enrichOcrResult(finalResult.parsed_data, finalResult)
                if (confirmedHeader) retryData.customer_header = confirmedHeader
                if (manualTransportFee > 0) retryData.transport = { ...(finalResult.transport || {}), amount: manualTransportFee, detected: true }
                await processFinalFlow(retryData, finalResult?.id || logId, publicUrl)
              } catch (err) {
                console.error(err)
                showToast('Correction failed: ' + err.message, 'error')
              }
            },
            onRescan: () => {
              selectedFile = null
              isScanning   = false
              container.querySelector('#preview-section').style.display = 'none'
              dropZone.style.display = 'block'
              fileInput.value = ''
            }
          })
        } else {
          await processFinalFlow(enrichOcrResult(parsedData, ocrResult), logId, publicUrl)
        }
      }

    } catch(err) {
      console.error('Scan error:', err)
      hideProgress()

      showToast(`Scan failed: ${err.message}`, 'error')

      // Offer manual entry fallback
      if (currentStore?.id) {
        const useManual = confirm('AI scan failed. Would you like to open manual entry mode instead?')
        if (useManual) {
          const { data: logData } = await supabase
            .from('ocr_logs')
            .insert({
              store_id:    currentStore?.id,
              image_url:   '',
              raw_text:    '',
              parsed_data: { line_items: [] },
              status:      'pending',
            })
            .select('id').single()

          if (logData?.id) {
            selectedFile = null
            container.querySelector('#preview-section').style.display = 'none'
            dropZone.style.display = 'block'
            fileInput.value = ''
            await openSmartOCRModal(logData.id)
            loadRecentScans()
          }
        }
      }
    }
  }

  // ── Final flow: persist log & open modal ──────────────
  async function processFinalFlow(parsedData, existingLogId, publicUrl) {
    showProgress('Preparing review...')

    let logId = existingLogId

    // Create an ocr_log if the edge function didn't create one
    if (!logId && currentStore?.id) {
      const { data: logData, error: logError } = await supabase
        .from('ocr_logs')
        .insert({
          store_id:    currentStore?.id,
          image_url:   publicUrl,
          raw_text:    '',
          parsed_data: parsedData,
          status:      'pending',
        }).select('id').single()
      if (logError) throw logError
      logId = logData?.id
    }

    if (!logId) throw new Error('Could not create scan record')

    hideProgress()
    selectedFile = null
    container.querySelector('#preview-section').style.display = 'none'
    dropZone.style.display = 'block'
    fileInput.value = ''

    await openSmartOCRModal(logId)
    loadRecentScans()
  }

  function showProgress(text) {
    container.querySelector('#preview-section').style.display  = 'none'
    container.querySelector('#progress-section').style.display = 'block'
    container.querySelector('#progress-text').textContent      = text
  }

  function hideProgress() {
    container.querySelector('#progress-section').style.display = 'none'
  }

  // ── Phase 1: Aggressive client-side image compression ─
  // Target: ≤500KB, max 1600px, WebP preferred with JPEG fallback
  async function compressImage(file) {
    if (file.type === 'application/pdf') return file

    return new Promise(resolve => {
      const img    = new Image()
      const reader = new FileReader()

      reader.onload = e => {
        img.onload = () => {
          const canvas = document.createElement('canvas')

          // Resize: max 1600px on longest edge
          const MAX = 1600
          let w = img.width
          let h = img.height

          if (w > h && w > MAX) { h = Math.round(h * MAX / w); w = MAX }
          else if (h > w && h > MAX) { w = Math.round(w * MAX / h); h = MAX }
          else if (w === h && w > MAX) { w = MAX; h = MAX }

          canvas.width  = w
          canvas.height = h

          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, 0, 0, w, h)

          // Prefer WebP (better compression), fall back to JPEG
          const tryWebP = () => new Promise(res => {
            canvas.toBlob(blob => {
              if (blob && blob.size > 0) res(blob)
              else res(null)
            }, 'image/webp', 0.82)
          })

          const tryJpeg = () => new Promise(res => {
            canvas.toBlob(blob => res(blob || file), 'image/jpeg', 0.80)
          })

          tryWebP().then(async webpBlob => {
            if (webpBlob) {
              // Accept WebP if it saved >10% vs original
              const savings = 1 - (webpBlob.size / file.size)
              if (savings > 0.1 || webpBlob.size < 500 * 1024) {
                resolve(webpBlob)
              } else {
                resolve(await tryJpeg())
              }
            } else {
              resolve(await tryJpeg())
            }
          })
        }
        img.onerror = () => resolve(file)
        img.src = e.target.result
      }
      reader.onerror = () => resolve(file)
      reader.readAsDataURL(file)
    })
  }

  // ── Recent scans ───────────────────────────────────────
  async function loadRecentScans() {
    if (!currentStore?.id) {
      container.querySelector('#recent-scans').innerHTML = `
        <div class="empty">
          <div class="empty-text">Select a store to view scans</div>
        </div>
      `
      return
    }

    const { data, error } = await supabase
      .from('ocr_logs')
      .select('*')
      .eq('store_id', currentStore?.id)
      .order('created_at', { ascending: false })
      .limit(15)

    const el = container.querySelector('#recent-scans')
    if (!el) return

    if (error || !data?.length) {
      el.innerHTML = `
        <div class="empty">
          ${renderIcon('scan', 28, 'var(--gray-300)')}
          <div class="empty-text" style="margin-top:0.75rem">No scans yet</div>
          <div class="empty-sub">Upload a receipt to get started</div>
        </div>
      `
      return
    }

    el.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Status</th>
              <th>Items</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${data.map(log => {
              const itemCount = log.parsed_data?.line_items?.length || 0
              const date = new Date(log.created_at).toLocaleDateString('en-ET', {
                day: '2-digit', month: 'short', year: 'numeric'
              })
              const wasProScan = log.parsed_data?.scan_mode === 'pro'
              return `
                <tr>
                  <td data-label="Date" style="font-weight:500">
                    ${date}
                    ${wasProScan ? `<span class="badge badge-teal" style="font-size:9px;margin-left:4px">AI</span>` : ''}
                  </td>
                  <td data-label="Status">
                    <span class="badge ${
                      log.status === 'applied'   ? 'badge-green'  :
                      log.status === 'pending'   ? 'badge-yellow' :
                      log.status === 'discarded' ? 'badge-grey'   : 'badge-teal'
                    }">${log.status}</span>
                  </td>
                  <td data-label="Items">
                    ${itemCount > 0
                      ? `<span style="font-weight:600">${itemCount}</span>
                         <span style="color:var(--muted);font-size:0.8125rem"> items</span>`
                      : '<span style="color:var(--muted)">—</span>'
                    }
                  </td>
                  <td data-label="Actions">
                    <div style="display:flex;gap:0.375rem;flex-wrap:wrap">
                      ${log.status !== 'applied' && log.status !== 'discarded' ? `
                        <button
                          class="btn btn-outline btn-sm"
                          data-action="review"
                          data-id="${log.id}"
                          style="gap:0.3rem"
                        >
                          ${renderIcon('scan', 12)} Review
                        </button>
                      ` : ''}
                      ${log.image_url ? `
                        <a
                          href="${log.image_url}"
                          target="_blank"
                          rel="noopener"
                          class="btn btn-ghost btn-sm"
                          style="gap:0.3rem"
                        >
                          ${renderIcon('reports', 12)} View
                        </a>
                      ` : ''}
                    </div>
                  </td>
                </tr>
              `
            }).join('')}
          </tbody>
        </table>
      </div>
    `

    // Review button handlers
    el.querySelectorAll('[data-action="review"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await openSmartOCRModal(btn.dataset.id)
        loadRecentScans()
      })
    })
  }

  // ── Init ───────────────────────────────────────────────
  loadRecentScans()
}

// ── Toast helper ─────────────────────────────────────────
function showToast(msg, type = 'info') {
  const t = document.createElement('div')
  t.className   = `toast toast-${type}` 
  t.textContent = msg
  let wrap = document.querySelector('.toast-container')
  if (!wrap) {
    wrap = document.createElement('div')
    wrap.className = 'toast-container'
    document.body.appendChild(wrap)
  }
  wrap.appendChild(t)
  setTimeout(() => t.remove(), 4000)
}
