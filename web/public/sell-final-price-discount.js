(() => {
  const MODE_ID = 'sedifex-final-price-discount'
  const money = value => `GHS ${Number(value || 0).toFixed(2)}`

  function parseMoney(text) {
    const normalized = String(text || '').replace(/[^0-9.-]/g, '')
    const value = Number(normalized)
    return Number.isFinite(value) ? value : 0
  }

  function setReactInputValue(input, value) {
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
    descriptor?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function findTotalsValue(label) {
    const rows = document.querySelectorAll('.sell-page__totals-row')
    for (const row of rows) {
      const first = row.querySelector(':scope > span')
      if (first?.textContent?.trim() !== label) continue
      const strong = row.querySelector('strong')
      if (strong) return parseMoney(strong.textContent)
      const hint = row.querySelector('.sell-page__totals-hint:not(.sell-page__totals-hint--error)')
      if (hint) return parseMoney(hint.textContent)
    }
    return 0
  }

  function findAmountPaidInput() {
    return Array.from(document.querySelectorAll('input[type="number"]')).find(input =>
      String(input.getAttribute('placeholder') || '').toLowerCase().includes('amount paid by client'),
    )
  }

  function additionalTenderTotal() {
    return Array.from(document.querySelectorAll('.sell-page__additional-row input[type="number"]'))
      .reduce((sum, input) => sum + Math.max(0, Number(input.value) || 0), 0)
  }

  function enhanceDiscount() {
    if (!location.pathname.startsWith('/sell')) return
    const discountInput = document.querySelector('input[placeholder="e.g. 5 or 5%"]')
    if (!discountInput || document.getElementById(MODE_ID)) return

    const row = discountInput.closest('.sell-page__totals-row')
    const inputColumn = discountInput.parentElement
    if (!row || !inputColumn) return

    const wrapper = document.createElement('div')
    wrapper.id = MODE_ID
    wrapper.className = 'sell-final-price'
    wrapper.innerHTML = `
      <div class="sell-final-price__modes" role="group" aria-label="Discount calculation method">
        <button type="button" class="is-active" data-mode="discount">Discount amount / percent</button>
        <button type="button" data-mode="final">Final selling price</button>
      </div>
      <div class="sell-final-price__panel" hidden>
        <label>
          <span>Customer should pay</span>
          <input type="number" min="0" step="0.01" inputmode="decimal" placeholder="Enter the agreed final price" />
        </label>
        <p class="sell-final-price__result">Enter the agreed price to calculate the discount automatically.</p>
        <p class="sell-final-price__error" role="alert" hidden></p>
      </div>
    `
    inputColumn.appendChild(wrapper)

    const discountModeButton = wrapper.querySelector('[data-mode="discount"]')
    const finalModeButton = wrapper.querySelector('[data-mode="final"]')
    const panel = wrapper.querySelector('.sell-final-price__panel')
    const finalInput = panel.querySelector('input')
    const result = wrapper.querySelector('.sell-final-price__result')
    const error = wrapper.querySelector('.sell-final-price__error')
    let finalMode = false
    let lastGross = null

    function currentGross() {
      const displayedTotal = findTotalsValue('Total')
      const currentDiscount = Number(discountInput.value) || 0
      return Math.max(0, displayedTotal + currentDiscount)
    }

    function syncPayment(finalPrice) {
      const paidInput = findAmountPaidInput()
      if (!paidInput) return
      const primaryAmount = Math.max(0, finalPrice - additionalTenderTotal())
      setReactInputValue(paidInput, primaryAmount.toFixed(2))
    }

    function calculate() {
      if (!finalMode) return
      const finalPrice = Number(finalInput.value)
      const gross = currentGross()
      lastGross = gross

      if (!finalInput.value.trim()) {
        error.hidden = true
        result.textContent = 'Enter the agreed price to calculate the discount automatically.'
        return
      }
      if (!Number.isFinite(finalPrice) || finalPrice < 0) {
        error.textContent = 'Enter a valid final selling price.'
        error.hidden = false
        return
      }
      if (finalPrice > gross) {
        setReactInputValue(discountInput, '')
        error.textContent = `Final price cannot be more than the original total of ${money(gross)}.`
        error.hidden = false
        result.textContent = 'No discount has been applied.'
        return
      }

      error.hidden = true
      const discount = Math.max(0, gross - finalPrice)
      const percentage = gross > 0 ? (discount / gross) * 100 : 0
      setReactInputValue(discountInput, discount ? discount.toFixed(2) : '')
      syncPayment(finalPrice)
      result.textContent = `Original ${money(gross)} · Discount ${money(discount)} (${percentage.toFixed(2)}%) · Customer pays ${money(finalPrice)}`
    }

    function selectMode(mode) {
      finalMode = mode === 'final'
      discountModeButton.classList.toggle('is-active', !finalMode)
      finalModeButton.classList.toggle('is-active', finalMode)
      panel.hidden = !finalMode
      discountInput.style.display = finalMode ? 'none' : ''

      if (finalMode) {
        setReactInputValue(discountInput, '')
        lastGross = null
        requestAnimationFrame(() => {
          const gross = currentGross()
          if (!finalInput.value) finalInput.value = gross ? gross.toFixed(2) : ''
          calculate()
          finalInput.focus()
          finalInput.select()
        })
      } else {
        finalInput.value = ''
        result.textContent = 'Enter the agreed price to calculate the discount automatically.'
        error.hidden = true
      }
    }

    discountModeButton.addEventListener('click', () => selectMode('discount'))
    finalModeButton.addEventListener('click', () => selectMode('final'))
    finalInput.addEventListener('input', calculate)

    const totalsObserver = new MutationObserver(() => {
      if (!finalMode || !finalInput.value.trim()) return
      const gross = currentGross()
      if (lastGross !== null && Math.abs(gross - lastGross) < 0.005) return
      calculate()
    })
    totalsObserver.observe(row.closest('.sell-page__totals') || row, { childList: true, subtree: true, characterData: true })
  }

  const observer = new MutationObserver(enhanceDiscount)
  observer.observe(document.documentElement, { childList: true, subtree: true })
  enhanceDiscount()
})()
