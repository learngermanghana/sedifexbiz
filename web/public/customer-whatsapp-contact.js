(() => {
  const ENHANCED_ATTR = 'data-sedifex-contact-actions'

  function normalizePhone(value) {
    const text = String(value || '').trim()
    if (!text) return ''
    const hasPlus = text.startsWith('+')
    let digits = text.replace(/\D/g, '')
    if (!digits) return ''
    if (text.startsWith('00')) digits = digits.replace(/^00/, '')
    else if (!hasPlus && text.startsWith('0')) digits = `233${digits.replace(/^0/, '')}`
    return digits
  }

  function parseContact(text) {
    const parts = String(text || '').split('•').map(part => part.trim()).filter(Boolean)
    const phone = parts.find(part => /\d/.test(part)) || ''
    const email = parts.find(part => part.includes('@')) || ''
    return { phone, email }
  }

  function escapeVCard(value) {
    return String(value || '')
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
  }

  function safeFilename(value) {
    const normalized = String(value || 'customer')
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9 _-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase()
    return normalized || 'customer'
  }

  function buildVCard({ name, phone, email }) {
    const lines = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${escapeVCard(name || 'Customer')}`,
      `N:${escapeVCard(name || 'Customer')};;;;`,
    ]
    if (phone) lines.push(`TEL;TYPE=CELL:${escapeVCard(phone)}`)
    if (email) lines.push(`EMAIL;TYPE=INTERNET:${escapeVCard(email)}`)
    lines.push('NOTE:Saved from Sedifex', 'END:VCARD')
    return `${lines.join('\r\n')}\r\n`
  }

  function downloadContact(contact) {
    const blob = new Blob([buildVCard(contact)], { type: 'text/vcard;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${safeFilename(contact.name)}.vcf`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function openWhatsApp(contact) {
    const phone = normalizePhone(contact.phone)
    if (!phone) return
    const message = encodeURIComponent(`Hello ${contact.name || 'there'}, thank you for being our customer.`)
    window.open(`https://wa.me/${phone}?text=${message}`, '_blank', 'noopener,noreferrer')
  }

  function makeButton(label, className, handler, disabled = false) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = className
    button.textContent = label
    button.disabled = disabled
    button.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      handler()
    })
    return button
  }

  function enhanceRows() {
    if (!location.pathname.startsWith('/customers')) return
    const rows = document.querySelectorAll('.customers-page table tbody tr')
    rows.forEach(row => {
      if (row.hasAttribute(ENHANCED_ATTR)) return
      const cells = row.querySelectorAll('td')
      if (cells.length < 2) return
      const actionsCell = row.querySelector('.customers-page__table-actions') || cells[cells.length - 1]
      if (!actionsCell) return

      const name = cells[0]?.textContent?.trim() || 'Customer'
      const { phone, email } = parseContact(cells[1]?.textContent)
      const contact = { name, phone, email }
      const group = document.createElement('span')
      group.className = 'customer-contact-actions'
      group.append(
        makeButton('WhatsApp', 'button button--outline button--small customer-contact-actions__whatsapp', () => openWhatsApp(contact), !normalizePhone(phone)),
        makeButton('Save contact', 'button button--ghost button--small', () => downloadContact(contact), !phone && !email),
      )
      actionsCell.prepend(group)
      row.setAttribute(ENHANCED_ATTR, 'true')
    })
  }

  function selectedContact() {
    const row = document.querySelector('.customers-page__row--selected')
    if (!row) return null
    const cells = row.querySelectorAll('td')
    if (cells.length < 2) return null
    const name = cells[0]?.textContent?.trim() || 'Customer'
    const { phone, email } = parseContact(cells[1]?.textContent)
    return { name, phone, email }
  }

  function enhanceDetails() {
    if (!location.pathname.startsWith('/customers')) return
    const detail = document.querySelector('.customers-page__details-content')
    if (!detail || detail.querySelector('[data-sedifex-save-contact]')) return
    const engageButtons = detail.querySelector('.customers-page__action-buttons')
    if (!engageButtons) return

    const button = makeButton('Save contact', 'button button--ghost button--small', () => {
      const contact = selectedContact()
      if (contact) downloadContact(contact)
    })
    button.setAttribute('data-sedifex-save-contact', 'true')
    engageButtons.appendChild(button)
  }

  function enhance() {
    enhanceRows()
    enhanceDetails()
  }

  const observer = new MutationObserver(enhance)
  observer.observe(document.documentElement, { childList: true, subtree: true })
  window.addEventListener('popstate', enhance)
  enhance()
})()
