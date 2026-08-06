(() => {
  const STORAGE_KEY = 'sedifex.customerAddedAt.v1'
  const NEW_DAYS = 7
  let applying = false
  let initialized = false
  let recentOnly = false
  let timer = null
  const knownKeys = new Set()

  function loadAddedAt() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
      return value && typeof value === 'object' ? value : {}
    } catch {
      return {}
    }
  }

  function saveAddedAt(value) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    } catch (error) {
      console.warn('[customers] Could not persist newly saved customer tracking', error)
    }
  }

  function rowKey(row) {
    const cells = row.querySelectorAll('td')
    const name = cells[0]?.textContent?.replace(/\s*New\s*$/i, '').trim().toLowerCase() || ''
    const contact = cells[1]?.textContent?.trim().toLowerCase() || ''
    return `${name}|${contact}`
  }

  function formatAddedAt(timestamp) {
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return '—'
    const now = new Date()
    if (date.toDateString() === now.toDateString()) {
      return `Today, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    }
    return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
  }

  function isNew(timestamp) {
    return Date.now() - Number(timestamp) <= NEW_DAYS * 24 * 60 * 60 * 1000
  }

  function ensureControls(table) {
    const card = table.closest('.card')
    const toolbar = card?.querySelector('.customers-page__toolbar')
    if (!toolbar || toolbar.querySelector('[data-sedifex-recently-added]')) return

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'button button--ghost button--small customer-new-tracking__filter'
    button.setAttribute('data-sedifex-recently-added', 'true')
    button.setAttribute('aria-pressed', 'false')
    button.textContent = 'Recently added'
    button.addEventListener('click', () => {
      recentOnly = !recentOnly
      button.classList.toggle('customer-new-tracking__filter--active', recentOnly)
      button.setAttribute('aria-pressed', String(recentOnly))
      applyTracking()
    })

    const target = toolbar.querySelector('.customers-page__tool-buttons') || toolbar
    target.prepend(button)
  }

  function ensureDateHeader(table) {
    const headerRow = table.querySelector('thead tr')
    if (!headerRow || headerRow.querySelector('[data-sedifex-date-added-header]')) return
    const actionsHeader = Array.from(headerRow.children).find(cell => cell.textContent?.trim() === 'Actions')
    const th = document.createElement('th')
    th.scope = 'col'
    th.textContent = 'Date added'
    th.setAttribute('data-sedifex-date-added-header', 'true')
    headerRow.insertBefore(th, actionsHeader || null)
  }

  function applyTracking() {
    if (applying || !location.pathname.startsWith('/customers')) return
    const table = document.querySelector('.customers-page table')
    const tbody = table?.querySelector('tbody')
    if (!table || !tbody) return

    applying = true
    try {
      ensureControls(table)
      ensureDateHeader(table)

      const rows = Array.from(tbody.querySelectorAll('tr'))
      const addedAt = loadAddedAt()
      const now = Date.now()

      rows.forEach(row => {
        const key = rowKey(row)
        if (!key || key === '|') return

        if (initialized && !knownKeys.has(key) && !Object.prototype.hasOwnProperty.call(addedAt, key)) {
          addedAt[key] = now
        }
        knownKeys.add(key)

        const timestamp = addedAt[key]
        const cells = row.querySelectorAll('td')
        const actionsCell = row.querySelector('.customers-page__table-actions') || cells[cells.length - 1]
        let dateCell = row.querySelector('[data-sedifex-date-added-cell]')
        if (!dateCell) {
          dateCell = document.createElement('td')
          dateCell.setAttribute('data-sedifex-date-added-cell', 'true')
          row.insertBefore(dateCell, actionsCell || null)
        }
        dateCell.textContent = timestamp ? formatAddedAt(timestamp) : 'Earlier'

        const nameCell = cells[0]
        let badge = nameCell?.querySelector('.customer-new-tracking__badge')
        if (timestamp && isNew(timestamp)) {
          if (!badge && nameCell) {
            badge = document.createElement('span')
            badge.className = 'customer-new-tracking__badge'
            badge.textContent = 'New'
            nameCell.appendChild(badge)
          }
        } else {
          badge?.remove()
        }

        row.hidden = recentOnly && !(timestamp && isNew(timestamp))
        row.dataset.sedifexAddedAt = timestamp ? String(timestamp) : '0'
      })

      saveAddedAt(addedAt)

      rows
        .sort((a, b) => Number(b.dataset.sedifexAddedAt || 0) - Number(a.dataset.sedifexAddedAt || 0))
        .forEach(row => tbody.appendChild(row))

      const trackedThisWeek = rows.filter(row => {
        const timestamp = Number(row.dataset.sedifexAddedAt || 0)
        return Boolean(timestamp && isNew(timestamp))
      }).length
      const badge = document.querySelector('.customers-page__badge')
      if (badge && !badge.querySelector('[data-sedifex-new-count]')) {
        const count = document.createElement('span')
        count.setAttribute('data-sedifex-new-count', 'true')
        count.textContent = ` • ${trackedThisWeek} new this week`
        badge.appendChild(count)
      } else {
        const count = badge?.querySelector('[data-sedifex-new-count]')
        if (count) count.textContent = ` • ${trackedThisWeek} new this week`
      }

      initialized = true
    } finally {
      applying = false
    }
  }

  const observer = new MutationObserver(() => {
    window.clearTimeout(timer)
    timer = window.setTimeout(applyTracking, 80)
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  window.addEventListener('popstate', applyTracking)
  applyTracking()
})()
