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

export function openColumnCorrectionModal({ imageUrl, columns, onSave, onRescan }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '400';
  overlay.style.display = 'flex';

  // Keep a stable original list to maintain index positions for the final output
  const originalColumns = columns.map((c, i) => ({ ...c, index: c.index !== undefined ? c.index : i }));
  let items = originalColumns.map(c => ({ ...c }));

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

  overlay.innerHTML = `
    <style>
      .ccm-wrap {
        max-width: 900px;
        width: 95%;
        max-height: 92dvh;
        display: flex;
        flex-direction: column;
        padding: 0;
        overflow: hidden;
      }
      .ccm-body {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }
      .ccm-img-panel {
        flex-shrink: 0;
        max-height: 36vw;
        min-height: 120px;
        overflow: hidden;
        background: var(--bg-subtle);
        border-bottom: 1px solid var(--border);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0.75rem;
      }
      .ccm-img-panel img {
        max-height: 100%;
        max-width: 100%;
        width: auto;
        border-radius: 8px;
        box-shadow: var(--shadow-md);
        object-fit: contain;
        display: block;
      }
      .ccm-map-panel {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0;
      }
      .ccm-col-row {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 0.875rem;
        margin-bottom: 0.625rem;
      }
      .ccm-col-row-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
      }
      .ccm-col-sample {
        flex: 1;
        min-width: 0;
      }
      .ccm-col-label {
        font-size: 0.625rem;
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
        font-size: 0.9375rem;
      }
      .ccm-col-remove {
        color: var(--danger);
        border: none;
        background: transparent;
        cursor: pointer;
        font-size: 1.4rem;
        padding: 0 0.25rem;
        line-height: 1;
        font-weight: 400;
        flex-shrink: 0;
        transition: opacity 0.15s;
      }
      .ccm-col-select {
        width: 100%;
        font-size: 0.875rem;
        font-weight: 600;
      }
      .ccm-actions {
        display: flex;
        gap: 0.75rem;
        padding: 0.875rem 1rem;
        border-top: 1px solid var(--border);
        background: var(--bg-base, #fff);
        flex-shrink: 0;
      }
      @media (min-width: 640px) {
        .ccm-body { flex-direction: row; }
        .ccm-img-panel {
          flex: 1;
          max-height: none;
          min-height: unset;
          border-bottom: none;
          border-right: 1px solid var(--border);
          padding: 1.5rem;
          overflow: auto;
          align-items: flex-start;
        }
        .ccm-img-panel img { max-height: none; }
        .ccm-map-panel {
          flex: 1;
          min-width: 300px;
          padding: 1.25rem 1.25rem 0;
        }
        .ccm-col-row { flex-direction: row; align-items: center; }
        .ccm-col-row-top { flex: 1; min-width: 0; }
        .ccm-col-select { width: 160px; }
        .ccm-actions { padding: 1rem 1.25rem 1.25rem; }
      }
    </style>

    <div class="modal ccm-wrap">
      <div style="padding:1rem 1.25rem 0.875rem; border-bottom:1px solid var(--border); flex-shrink:0;">
        <h2 style="font-size:1.375rem; font-weight:700; margin:0 0 0.2rem 0;">Correct Column Types</h2>
        <p style="color:var(--muted); margin:0; font-size:0.875rem;">Rename or remove columns. Only keep the ones you need.</p>
      </div>

      <div class="ccm-body">
        <!-- Image panel -->
        <div class="ccm-img-panel">
          <img src="${imageUrl}" alt="Receipt">
        </div>

        <!-- Mapping panel -->
        <div class="ccm-map-panel">
          <div id="col-list-container">
            ${renderList()}
          </div>
        </div>
      </div>

      <!-- Action buttons always pinned to bottom -->
      <div class="ccm-actions">
        <button id="btn-col-save" class="btn btn-primary" style="flex:2; justify-content:center; padding:0.75rem; font-size:0.9375rem;">
          Save &amp; Continue
        </button>
        <button id="btn-col-rescan" class="btn btn-outline" style="flex:1; justify-content:center; padding:0.75rem; font-size:0.9375rem;">
          Re-scan
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  function attachListEvents() {
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
    overlay.remove();
    if (onSave) onSave(manualTypes);
  });

  overlay.querySelector('#btn-col-rescan').addEventListener('click', () => {
    overlay.remove();
    if (onRescan) onRescan();
  });
}
