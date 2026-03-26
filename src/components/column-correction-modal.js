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
      <div data-index="${col.index}" style="
        display:flex; align-items:center; gap:1rem; 
        background:var(--bg-elevated); border:1px solid var(--border); 
        border-radius:12px; padding:1rem; margin-bottom:0.75rem;
      ">
        <div style="flex:1; min-width:0; margin-right:0.5rem;">
          <div style="font-size:0.6875rem; font-weight:700; color:var(--muted); margin-bottom:4px; text-transform:uppercase;">First Row Sample</div>
          <div style="font-weight:600; color:var(--dark); word-break:break-word; font-size:0.9375rem;">${col.sample || '—'}</div>
        </div>

        <select class="form-input col-type-select" data-index="${col.index}" style="width:160px; font-size:0.875rem; font-weight:600; padding:0.5rem;">
          ${COLUMN_OPTIONS.map(opt => `
            <option value="${opt.value}" ${col.type === opt.value ? 'selected' : ''}>
              ${opt.label}
            </option>
          `).join('')}
          ${!COLUMN_OPTIONS.find(o => o.value === col.type) && col.type ? `<option value="${col.type}" selected>${col.type}</option>` : ''}
        </select>

        <button class="col-remove-btn" data-index="${col.index}" style="
          color:var(--danger); border:none; background:transparent; cursor:pointer;
          font-size:1.5rem; padding:0 0.25rem; line-height:1; font-weight:400; transition:opacity 0.15s;
        " title="Remove column">×</button>
      </div>
    `).join('');
  }

  overlay.innerHTML = `
    <div class="modal" style="max-width:900px; width:95%; max-height:92vh; display:flex; flex-direction:column; padding:0;">
      <div style="padding:1.25rem 1.5rem; border-bottom:1px solid var(--border);">
        <h2 style="font-size:1.5rem; font-weight:600; margin:0 0 0.25rem 0;">Correct Column Types</h2>
        <p style="color:var(--muted); margin:0;">Rename or remove columns. Only keep the ones you need.</p>
      </div>

      <div style="display:flex; flex:1; overflow:hidden; flex-wrap:wrap;">
        <!-- Left: Image -->
        <div style="flex:1; min-width:300px; border-right:1px solid var(--border); overflow:auto; padding:1.5rem; background:var(--bg-subtle);">
          <img src="${imageUrl}" alt="Receipt" style="max-width:100%; display:block; border-radius:8px; box-shadow:var(--shadow-md); margin:0 auto;">
        </div>

        <!-- Right: Settings -->
        <div style="flex:1; min-width:340px; padding:1.5rem; overflow:auto; display:flex; flex-direction:column;">
          <div id="col-list-container" style="flex:1;">
            ${renderList()}
          </div>

          <div style="display:flex; gap:0.75rem; margin-top:1.5rem;">
            <button id="btn-col-save" class="btn btn-primary" style="flex:2; justify-content:center; padding:0.875rem; font-size:1rem;">
              Looks Good – Save & Continue
            </button>
            <button id="btn-col-rescan" class="btn btn-outline" style="flex:1; justify-content:center; padding:0.875rem; font-size:1rem;">
              Re-scan
            </button>
          </div>
        </div>
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
