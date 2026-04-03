// notification-manager.js — Professional Enterprise-Grade Notification System
// NO EMOJIS. Clean CSS animations, SVG icons, modern design.

let notificationContainer = null
let activeNotifications = new Map()
let notificationIdCounter = 0

/**
 * Initialize the notification system
 * Creates the floating toast container in bottom-right
 */
export function initNotificationSystem() {
  if (notificationContainer) return

  notificationContainer = document.createElement('div')
  notificationContainer.id = 'notification-container'
  notificationContainer.className = 'notification-container'
  document.body.appendChild(notificationContainer)

  // Inject CSS
  if (!document.getElementById('notification-styles')) {
    const style = document.createElement('style')
    style.id = 'notification-styles'
    style.textContent = `
      .notification-container {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 12px;
        max-width: 400px;
        pointer-events: none;
      }

      @media (max-width: 768px) {
        .notification-container {
          bottom: 80px;
          right: 16px;
          left: 16px;
          max-width: none;
        }
      }

      .notification-toast {
        background: #ffffff;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15), 0 2px 8px rgba(0, 0, 0, 0.1);
        padding: 16px 20px;
        display: flex;
        align-items: flex-start;
        gap: 14px;
        border-left: 4px solid #0D9488;
        min-height: 72px;
        pointer-events: auto;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        animation: slideIn 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        transform-origin: bottom right;
      }

      .notification-toast:hover {
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2), 0 4px 12px rgba(0, 0, 0, 0.12);
        transform: translateY(-2px);
      }

      .notification-toast.loading {
        border-left-color: #0D9488;
        cursor: default;
      }

      .notification-toast.success {
        border-left-color: #10B981;
      }

      .notification-toast.error {
        border-left-color: #EF4444;
      }

      .notification-toast.closing {
        animation: slideOut 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards;
      }

      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateX(100%) scale(0.9);
        }
        to {
          opacity: 1;
          transform: translateX(0) scale(1);
        }
      }

      @keyframes slideOut {
        to {
          opacity: 0;
          transform: translateX(100%) scale(0.9);
        }
      }

      .notification-icon {
        flex-shrink: 0;
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 10px;
        background: #F0FDFA;
      }

      .notification-toast.loading .notification-icon {
        background: #F0FDFA;
      }

      .notification-toast.success .notification-icon {
        background: #ECFDF5;
      }

      .notification-toast.error .notification-icon {
        background: #FEF2F2;
      }

      .notification-spinner {
        width: 24px;
        height: 24px;
        border: 3px solid #E0F2F1;
        border-top-color: #0D9488;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      .notification-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }

      .notification-title {
        font-size: 15px;
        font-weight: 600;
        color: #111827;
        line-height: 1.4;
      }

      .notification-message {
        font-size: 13px;
        color: #6B7280;
        line-height: 1.5;
      }

      .notification-close {
        flex-shrink: 0;
        width: 24px;
        height: 24px;
        border: none;
        background: none;
        cursor: pointer;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        color: #9CA3AF;
        transition: all 0.2s;
        margin-top: -2px;
      }

      .notification-close:hover {
        background: #F3F4F6;
        color: #374151;
      }

      .notification-close svg {
        width: 16px;
        height: 16px;
      }
    `
    document.head.appendChild(style)
  }
}

/**
 * Create SVG icon for different states
 */
function createIcon(type) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '24')
  svg.setAttribute('height', '24')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')

  if (type === 'success') {
    svg.style.color = '#10B981'
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', 'M20 6L9 17l-5-5')
    svg.appendChild(path)
  } else if (type === 'error') {
    svg.style.color = '#EF4444'
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    circle.setAttribute('cx', '12')
    circle.setAttribute('cy', '12')
    circle.setAttribute('r', '10')
    svg.appendChild(circle)
    const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    line1.setAttribute('x1', '12')
    line1.setAttribute('y1', '8')
    line1.setAttribute('x2', '12')
    line1.setAttribute('y2', '12')
    svg.appendChild(line1)
    const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    line2.setAttribute('x1', '12')
    line2.setAttribute('y1', '16')
    line2.setAttribute('x2', '12.01')
    line2.setAttribute('y2', '16')
    svg.appendChild(line2)
  }

  return svg
}

/**
 * Create close button SVG
 */
function createCloseIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')

  const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  line1.setAttribute('x1', '18')
  line1.setAttribute('y1', '6')
  line1.setAttribute('x2', '6')
  line1.setAttribute('y2', '18')
  svg.appendChild(line1)

  const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  line2.setAttribute('x1', '6')
  line2.setAttribute('y1', '6')
  line2.setAttribute('x2', '18')
  line2.setAttribute('y2', '18')
  svg.appendChild(line2)

  return svg
}

/**
 * Show a notification
 * @param {Object} options
 * @param {string} options.type - 'loading' | 'success' | 'error'
 * @param {string} options.title - Main title text
 * @param {string} options.message - Optional subtitle/message
 * @param {Function} options.onClick - Optional click handler
 * @param {boolean} options.persistent - If true, won't auto-dismiss
 * @param {string} options.id - Optional ID to update existing notification
 * @returns {string} Notification ID
 */
export function showNotification({ type = 'loading', title, message = '', onClick = null, persistent = false, id = null }) {
  initNotificationSystem()

  const notificationId = id || `notification-${++notificationIdCounter}`

  // If updating existing notification
  if (id && activeNotifications.has(id)) {
    const existingToast = activeNotifications.get(id)
    updateNotification(existingToast, { type, title, message, onClick, persistent })
    return id
  }

  // Create new notification
  const toast = document.createElement('div')
  toast.className = `notification-toast ${type}`
  toast.dataset.id = notificationId

  // Icon container
  const iconContainer = document.createElement('div')
  iconContainer.className = 'notification-icon'

  if (type === 'loading') {
    const spinner = document.createElement('div')
    spinner.className = 'notification-spinner'
    iconContainer.appendChild(spinner)
  } else {
    iconContainer.appendChild(createIcon(type))
  }

  // Content
  const content = document.createElement('div')
  content.className = 'notification-content'

  const titleEl = document.createElement('div')
  titleEl.className = 'notification-title'
  titleEl.textContent = title
  content.appendChild(titleEl)

  if (message) {
    const messageEl = document.createElement('div')
    messageEl.className = 'notification-message'
    messageEl.textContent = message
    content.appendChild(messageEl)
  }

  // Close button
  const closeBtn = document.createElement('button')
  closeBtn.className = 'notification-close'
  closeBtn.appendChild(createCloseIcon())
  closeBtn.onclick = (e) => {
    e.stopPropagation()
    dismissNotification(notificationId)
  }

  // Assemble
  toast.appendChild(iconContainer)
  toast.appendChild(content)
  toast.appendChild(closeBtn)

  // Click handler
  if (onClick && type !== 'loading') {
    toast.style.cursor = 'pointer'
    toast.onclick = () => {
      onClick()
      dismissNotification(notificationId)
    }
  }

  // Add to container
  notificationContainer.appendChild(toast)
  activeNotifications.set(notificationId, toast)

  // Auto-dismiss for non-persistent notifications
  if (!persistent && type !== 'loading') {
    setTimeout(() => {
      if (activeNotifications.has(notificationId)) {
        dismissNotification(notificationId)
      }
    }, type === 'error' ? 8000 : 6000)
  }

  return notificationId
}

/**
 * Update an existing notification
 */
function updateNotification(toast, { type, title, message, onClick, persistent }) {
  // Update class
  toast.className = `notification-toast ${type}`

  // Update icon
  const iconContainer = toast.querySelector('.notification-icon')
  iconContainer.innerHTML = ''
  if (type === 'loading') {
    const spinner = document.createElement('div')
    spinner.className = 'notification-spinner'
    iconContainer.appendChild(spinner)
  } else {
    iconContainer.appendChild(createIcon(type))
  }

  // Update content
  const titleEl = toast.querySelector('.notification-title')
  titleEl.textContent = title

  let messageEl = toast.querySelector('.notification-message')
  if (message) {
    if (!messageEl) {
      messageEl = document.createElement('div')
      messageEl.className = 'notification-message'
      toast.querySelector('.notification-content').appendChild(messageEl)
    }
    messageEl.textContent = message
  } else if (messageEl) {
    messageEl.remove()
  }

  // Update click handler
  if (onClick && type !== 'loading') {
    toast.style.cursor = 'pointer'
    toast.onclick = () => {
      onClick()
      dismissNotification(toast.dataset.id)
    }
  } else {
    toast.style.cursor = type === 'loading' ? 'default' : 'pointer'
    toast.onclick = null
  }

  // Auto-dismiss for non-persistent
  if (!persistent && type !== 'loading') {
    setTimeout(() => {
      if (activeNotifications.has(toast.dataset.id)) {
        dismissNotification(toast.dataset.id)
      }
    }, type === 'error' ? 8000 : 6000)
  }
}

/**
 * Dismiss a notification
 */
export function dismissNotification(id) {
  const toast = activeNotifications.get(id)
  if (!toast) return

  toast.classList.add('closing')
  setTimeout(() => {
    toast.remove()
    activeNotifications.delete(id)
  }, 300)
}

/**
 * Dismiss all notifications
 */
export function dismissAllNotifications() {
  activeNotifications.forEach((toast, id) => {
    dismissNotification(id)
  })
}

/**
 * OCR-specific notification helpers
 */
export const OCRNotifications = {
  /**
   * Show "Analyzing receipt..." loading notification
   */
  showAnalyzing() {
    return showNotification({
      id: 'ocr-scan',
      type: 'loading',
      title: 'Analyzing receipt...',
      message: 'AI is reading your document',
      persistent: true
    })
  },

  /**
   * Show "Scan Complete" success notification
   */
  showSuccess(onReview) {
    return showNotification({
      id: 'ocr-scan',
      type: 'success',
      title: 'Scan Complete',
      message: 'Click here to review and confirm',
      onClick: onReview,
      persistent: true
    })
  },

  /**
   * Show error notification with specific message
   */
  showError(errorMessage, onRetry = null) {
    return showNotification({
      id: 'ocr-scan',
      type: 'error',
      title: 'Scan Failed',
      message: errorMessage,
      onClick: onRetry,
      persistent: false
    })
  },

  /**
   * Dismiss OCR notification
   */
  dismiss() {
    dismissNotification('ocr-scan')
  }
}
