export function enhanceTables(root = document) {
  const tables = root.querySelectorAll('table')
  tables.forEach(table => {
    const headers = Array.from(table.querySelectorAll('thead th'))
      .map(th => th.textContent.trim())

    if (!headers.length) return

    const rows = table.querySelectorAll('tbody tr')
    rows.forEach(row => {
      const cells = row.querySelectorAll('td')
      cells.forEach((td, i) => {
        if (headers[i] && headers[i] !== '') {
          td.setAttribute('data-label', headers[i])
        }
      })
    })
  })
}

export function initTableEnhancer() {
  enhanceTables()

  const observer = new MutationObserver((mutations) => {
    let hasTableChanges = false
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) {
            if (node.tagName === 'TABLE' ||
                node.tagName === 'TR' ||
                node.tagName === 'TBODY' ||
                node.querySelector?.('table')) {
              hasTableChanges = true
              break
            }
          }
        }
      }
      if (hasTableChanges) break
    }
    if (hasTableChanges) {
      setTimeout(() => enhanceTables(), 50)
    }
  })

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  })

  return observer
}