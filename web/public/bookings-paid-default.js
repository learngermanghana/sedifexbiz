(() => {
  const PAGE_SELECTOR = '.bookings-page'
  const TABS_SELECTOR = '.bookings-page__tabs'
  const INITIALIZED_ATTR = 'data-sedifex-paid-default-initialized'
  let applying = false

  function findPaidTab(tabs) {
    return Array.from(tabs.querySelectorAll('button')).find(
      button => button.textContent?.trim().toLowerCase() === 'paid',
    )
  }

  function addNotice(page, tabs) {
    if (page.querySelector('[data-sedifex-paid-bookings-notice]')) return

    const notice = document.createElement('p')
    notice.className = 'bookings-paid-default-notice'
    notice.setAttribute('data-sedifex-paid-bookings-notice', 'true')
    notice.innerHTML =
      '<strong>Paid bookings are shown by default when this page opens.</strong> Use <strong>Awaiting payment</strong> to review pending or unsuccessful payment attempts, or <strong>All</strong> to see every booking.'
    tabs.insertAdjacentElement('afterend', notice)
  }

  function apply() {
    if (applying) return
    applying = true

    try {
      const page = document.querySelector(PAGE_SELECTOR)
      const tabs = page?.querySelector(TABS_SELECTOR)
      if (!page || !tabs) return

      addNotice(page, tabs)

      if (page.hasAttribute(INITIALIZED_ATTR)) return

      const paidTab = findPaidTab(tabs)
      if (!paidTab) return

      page.setAttribute(INITIALIZED_ATTR, 'true')
      if (!paidTab.classList.contains('is-active')) paidTab.click()
    } finally {
      applying = false
    }
  }

  const observer = new MutationObserver(() => window.requestAnimationFrame(apply))
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })

  window.addEventListener('popstate', apply)
  apply()
})()
