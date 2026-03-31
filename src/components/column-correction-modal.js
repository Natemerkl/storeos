/* src/components/column-correction-modal.js */
const COLUMN_OPTIONS = [
  { value: 'name',        label: 'Product Name' },
  { value: 'description', label: 'Description' },
  { value: 'qty',         label: 'Quantity' },
  { value: 'price',       label: 'Selling Price' },
  { value: 'unit_price',  label: 'Unit Price' },
  { value: 'amount',      label: 'Amount / Total' },
  { value: 'quantity',    label: 'Quantity (alt)' },
  { value: 'model',       label: 'Model / SKU' },
  { value: 'ignore',      label: '— Ignore this column —' },
];

export function openColumnCorrectionModal({ imageUrl, columns, onSave, onRescan, customerHeader = {}, transport = null }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '400';
  overlay.style.display = 'flex';

  // Keep a stable original list to maintain index positions for the final output
  const originalColumns = columns.map((c, i) => ({ ...c, index: c.index !== undefined ? c.index : i }));
  let items = originalColumns.map(c => ({ ...c }));

  let custName  = customerHeader.name  || ''
  let custTarga = customerHeader.targa || ''
  let custPlace = customerHeader.place || ''
  let manualTransportFee = 0

  function renderList() {
    return items.map((col) => `
      <div class="ccm-col-row" data-index="${col.index}">
        <div class="ccm-col-row-top">
          <div class="ccm-col-sample">
            <div class="ccm-col-label">First Row Sample</div>
            <div class="ccm-col-value">${col.sample || '—'}</div>
          </div>
          <button class="col-remove-btn ccm-col-remove" data-index="${col.index}" title="Remove column">×</button>
        </div>
        <select class="form-input col-type-select ccm-col-select" data-index="${col.index}" style="padding:0.5rem;">
          ${COLUMN_OPTIONS.map(opt => `
            <option value="${opt.value}" ${col.type === opt.value ? 'selected' : ''}>${opt.label}</option>
          `).join('')}
          ${!COLUMN_OPTIONS.find(o => o.value === col.type) && col.type ? `<option value="${col.type}" selected>${col.type}</option>` : ''}
        </select>
      </div>
    `).join('');
  }

  // Lock body scroll while modal is open
  const _prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  overlay.innerHTML = `
    <style>
      .ccm-wrap {
        max-width: 900px;
        width: 96%;
        max-height: 90dvh;
        display: flex;
        flex-direction: column;
        padding: 0;
        overflow: hidden;
        border-radius: 16px;
      }
      /* Always row: image mini-panel left, mapping right */
      .ccm-body {
        display: flex;
        flex-direction: row;
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }
      .ccm-img-panel {
        width: 96px;
        flex-shrink: 0;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        background: var(--bg-subtle);
        border-right: 1px solid var(--border);
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 0.625rem 0.5rem;
        gap: 0.5rem;
      }
      .ccm-img-panel img {
        width: 100%;
        height: auto;
        border-radius: 6px;
        box-shadow: var(--shadow-md);
        object-fit: contain;
        display: block;
      }
      .ccm-img-label {
        font-size: 0.6rem;
        font-weight: 700;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.4px;
        text-align: center;
      }
      /* Mapping panel: fills remaining width, scrolls independently */
      .ccm-map-panel {
        flex: 1;
        min-width: 0;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior: contain;
        touch-action: pan-y;
        padding: 0.75rem;
      }
      .ccm-col-row {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 0.75rem;
        margin-bottom: 0.5rem;
      }
      .ccm-col-row-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
      }
      .ccm-col-sample { flex: 1; min-width: 0; }
      .ccm-col-label {
        font-size: 0.6rem;
        font-weight: 700;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 2px;
      }
      .ccm-col-value {
        font-weight: 600;
        color: var(--dark);
        word-break: break-word;
        font-size: 0.875rem;
      }
      .ccm-col-remove {
        color: var(--danger);
        border: none;
        background: transparent;
        cursor: pointer;
        font-size: 1.4rem;
        padding: 0 0.125rem;
        line-height: 1;
        font-weight: 400;
        flex-shrink: 0;
      }
      .ccm-col-select {
        width: 100%;
        font-size: 0.8125rem;
        font-weight: 600;
        padding: 0.4rem 0.5rem;
      }
      .ccm-cust-strip {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
        background: var(--bg-subtle);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 0.625rem 0.75rem;
        margin-bottom: 0.625rem;
      }
      .ccm-cust-field {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        flex: 1;
        min-width: 100px;
      }
      .ccm-cust-field span {
        font-size: 1rem;
        flex-shrink: 0;
      }
      .ccm-cust-field input {
        flex: 1;
        font-size: 0.8125rem;
        font-weight: 600;
        padding: 0.3rem 0.5rem;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--bg-elevated);
        color: var(--dark);
        min-width: 0;
      }
      .ccm-transport-notice {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        background: #FFF9EC;
        border: 1px solid #FDE68A;
        border-radius: 8px;
        padding: 0.5rem 0.75rem;
        margin-bottom: 0.625rem;
        font-size: 0.8125rem;
        font-weight: 600;
        color: #92400E;
      }
      .ccm-actions {
        display: flex;
        gap: 0.625rem;
        padding: 0.75rem 0.875rem;
        border-top: 1px solid var(--border);
        background: var(--bg-base, #fff);
        flex-shrink: 0;
      }
      /* Wider screens: enlarge image panel */
      @media (min-width: 600px) {
        .ccm-img-panel {
          width: 220px;
          padding: 1.25rem;
        }
        .ccm-map-panel { padding: 1.25rem; }
        .ccm-col-row { padding: 1rem; gap: 0.5rem; }
        .ccm-col-value { font-size: 0.9375rem; }
        .ccm-col-select { font-size: 0.875rem; }
        .ccm-actions { padding: 1rem 1.25rem; }
      }
      @media (min-width: 900px) {
        .ccm-img-panel { width: 340px; }
      }
    </style>

    <div class="modal ccm-wrap">
      <div style="padding:0.875rem 1.125rem; border-bottom:1px solid var(--border); flex-shrink:0;">
        <h2 style="font-size:1.25rem; font-weight:700; margin:0 0 0.15rem 0;">Correct Column Types</h2>
        <p style="color:var(--muted); margin:0; font-size:0.8125rem;">Rename or remove columns. Only keep the ones you need.</p>
      </div>

      <div class="ccm-body">
        <!-- Image: compact side panel -->
        <div class="ccm-img-panel">
          <div class="ccm-img-label">Receipt</div>
          <img src="${imageUrl}" alt="Receipt">
        </div>

        <!-- Mapping: scrolls independently -->
        <div class="ccm-map-panel">

          <!-- Customer header strip -->
          <div class="ccm-cust-strip">
            <div class="ccm-cust-field">
              <span>👤</span>
              <input id="ccm-cust-name" placeholder="Customer name" value="${custName}">
            </div>
            <div class="ccm-cust-field">
              <span>🚗</span>
              <input id="ccm-cust-targa" placeholder="Plate / Targa" value="${custTarga}" style="text-transform:uppercase;font-family:monospace">
            </div>
            <div class="ccm-cust-field">
              <span>📍</span>
              <input id="ccm-cust-place" placeholder="Delivery place" value="${custPlace}">
            </div>
          </div>

          <!-- Transport notice -->
          ${transport?.detected ? `
            <div class="ccm-transport-notice">
              🚚 Transport fee detected: ${transport.amount ? Number(transport.amount).toLocaleString('en-ET') + ' ETB' : ''}
              &nbsp;— configure it in the next screen.
            </div>
          ` : `
            <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:0.625rem 0.75rem;margin-bottom:0.625rem">
              <div style="font-size:0.6875rem;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:0.375rem">🚚 Transport / Labor Fee (Optional)</div>
              <input type="number" id="ccm-transport-fee" min="0" placeholder="e.g. 1500" style="width:100%;padding:0.4rem 0.5rem;border:1px solid #FCD34D;border-radius:6px;font-size:0.875rem;font-weight:600;background:#fff">
              <div style="font-size:0.75rem;color:#92400E;margin-top:0.25rem">Leave blank if none</div>
            </div>
          `}

          <div id="col-list-container">
            ${renderList()}
          </div>
        </div>
      </div>

      <div class="ccm-actions">
        <button id="btn-col-save" class="btn btn-primary" style="flex:2; justify-content:center; padding:0.625rem 0.75rem; font-size:0.9rem;">
          Save &amp; Continue
        </button>
        <button id="btn-col-rescan" class="btn btn-outline" style="flex:1; justify-content:center; padding:0.625rem 0.75rem; font-size:0.9rem;">
          Re-scan
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  function attachListEvents() {
    overlay.querySelector('#ccm-cust-name')?.addEventListener('input',  e => { custName  = e.target.value })
    overlay.querySelector('#ccm-cust-targa')?.addEventListener('input', e => { custTarga = e.target.value.toUpperCase() })
    overlay.querySelector('#ccm-cust-place')?.addEventListener('input', e => { custPlace = e.target.value })

    const listContainer = overlay.querySelector('#col-list-container');
    
    listContainer.querySelectorAll('.col-type-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const idx = Number(e.target.dataset.index);
        const item = items.find(i => i.index === idx); 
        if (item) item.type = e.target.value;
      });
    });

    listContainer.querySelectorAll('.col-remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = Number(e.target.dataset.index);
        items = items.filter(i => i.index !== idx);
        listContainer.innerHTML = renderList();
        attachListEvents();
      });
    });
  }

  attachListEvents();

  // Transport fee input handler
  const transportInput = overlay.querySelector('#ccm-transport-fee');
  if (transportInput) {
    transportInput.addEventListener('input', (e) => {
      manualTransportFee = parseFloat(e.target.value) || 0;
    });
  }

  // Controls
  overlay.querySelector('#btn-col-save').addEventListener('click', () => {
    if (items.length === 0) {
      alert("You must keep at least one column");
      return;
    }
    // Build output the same length as originalColumns.
    // Removed columns get 'ignore' so the backend keeps column positions stable.
    const manualTypes = originalColumns.map(orig => {
      const found = items.find(i => i.index === orig.index);
      return found ? found.type : 'ignore';
    });
    document.body.style.overflow = _prevOverflow;
    overlay.remove();
    if (onSave) onSave(manualTypes, { name: custName || null, targa: custTarga || null, place: custPlace || null }, manualTransportFee);
  });

  overlay.querySelector('#btn-col-rescan').addEventListener('click', () => {
    document.body.style.overflow = _prevOverflow;
    overlay.remove();
    if (onRescan) onRescan();
  });
}
