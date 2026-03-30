import { appStore } from '../store.js'
import { renderIcon } from './icons.js'

const PRESETS = [
  { value: 'alltime', label: 'All Time' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7days', label: 'Last 7 Days' },
  { value: 'last30days', label: 'Last 30 Days' },
  { value: 'thisMonth', label: 'This Month' },
  { value: 'custom', label: 'Custom Range' },
]

function calculateDateRange(preset) {
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]
  
  switch (preset) {
    case 'alltime':
      return { startDate: null, endDate: null }
    
    case 'today':
      return { startDate: todayStr, endDate: todayStr }
    
    case 'yesterday': {
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)
      const yesterdayStr = yesterday.toISOString().split('T')[0]
      return { startDate: yesterdayStr, endDate: yesterdayStr }
    }
    
    case 'last7days': {
      const sevenDaysAgo = new Date(today)
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
      return { startDate: sevenDaysAgo.toISOString().split('T')[0], endDate: todayStr }
    }
    
    case 'last30days': {
      const thirtyDaysAgo = new Date(today)
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29)
      return { startDate: thirtyDaysAgo.toISOString().split('T')[0], endDate: todayStr }
    }
    
    case 'thisMonth': {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1)
      return { startDate: firstDay.toISOString().split('T')[0], endDate: todayStr }
    }
    
    default:
      return { startDate: todayStr, endDate: todayStr }
  }
}

export function renderDateRangeSelector(container) {
  const { dateRange } = appStore.getState()
  
  const html = `
    <div id="date-range-selector" style="
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    ">
      <select id="date-preset" class="form-input" style="
        font-size: 0.8125rem;
        padding: 0.4rem 0.5rem;
        font-weight: 500;
        border-radius: 6px;
        min-width: 120px;
      ">
        ${PRESETS.map(p => `
          <option value="${p.value}" ${dateRange.preset === p.value ? 'selected' : ''}>
            ${p.label}
          </option>
        `).join('')}
      </select>
      
      <div id="custom-dates" style="
        display: ${dateRange.preset === 'custom' ? 'flex' : 'none'};
        align-items: center;
        gap: 0.375rem;
      ">
        <input type="date" id="start-date" class="form-input" 
          value="${dateRange.startDate || ''}"
          style="font-size: 0.75rem; padding: 0.375rem 0.5rem; max-width: 130px; border-radius: 6px;">
        <span style="color: var(--muted); font-size: 0.75rem;">→</span>
        <input type="date" id="end-date" class="form-input" 
          value="${dateRange.endDate || ''}"
          style="font-size: 0.75rem; padding: 0.375rem 0.5rem; max-width: 130px; border-radius: 6px;">
      </div>
    </div>
  `
  
  container.innerHTML = html
  attachEventListeners()
}

function formatDateRangeLabel(dateRange) {
  if (dateRange.startDate === dateRange.endDate) {
    return new Date(dateRange.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  const start = new Date(dateRange.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const end = new Date(dateRange.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${start} - ${end}`
}

function attachEventListeners() {
  const presetSelect = document.getElementById('date-preset')
  const customDates = document.getElementById('custom-dates')
  const startDateInput = document.getElementById('start-date')
  const endDateInput = document.getElementById('end-date')
  
  if (!presetSelect) return
  
  presetSelect.addEventListener('change', (e) => {
    const preset = e.target.value
    
    if (preset === 'custom') {
      customDates.style.display = 'flex'
      const current = appStore.getState().dateRange
      appStore.getState().setDateRange({
        startDate: current.startDate,
        endDate: current.endDate,
        preset: 'custom'
      })
    } else {
      customDates.style.display = 'none'
      const range = calculateDateRange(preset)
      appStore.getState().setDateRange({
        ...range,
        preset
      })
      triggerDateRangeChange()
    }
  })
  
  if (startDateInput) {
    startDateInput.addEventListener('change', (e) => {
      const current = appStore.getState().dateRange
      appStore.getState().setDateRange({
        startDate: e.target.value,
        endDate: current.endDate,
        preset: 'custom'
      })
      triggerDateRangeChange()
    })
  }
  
  if (endDateInput) {
    endDateInput.addEventListener('change', (e) => {
      const current = appStore.getState().dateRange
      appStore.getState().setDateRange({
        startDate: current.startDate,
        endDate: e.target.value,
        preset: 'custom'
      })
      triggerDateRangeChange()
    })
  }
}

function triggerDateRangeChange() {
  // Dispatch custom event that pages can listen to
  window.dispatchEvent(new CustomEvent('dateRangeChanged', {
    detail: appStore.getState().dateRange
  }))
}

// Subscribe to store changes and re-render
let currentContainer = null

export function initDateRangeSelector(container) {
  currentContainer = container
  renderDateRangeSelector(container)
  
  // Subscribe to store changes
  appStore.subscribe((state) => {
    if (currentContainer) {
      renderDateRangeSelector(currentContainer)
    }
  })
}
