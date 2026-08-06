(() => {
  const DISMISSED_KEY = 'sedifex.expandWorkspacePrompt.dismissed.v1'
  const ENHANCED_ATTR = 'data-sedifex-expand-enhanced'
  let applying = false

  function isDesktop() {
    return window.matchMedia('(min-width: 961px)').matches
  }

  function isCollapsed() {
    return Boolean(document.querySelector('.shell--nav-collapsed'))
  }

  function dismissPrompt() {
    try {
      localStorage.setItem(DISMISSED_KEY, 'true')
    } catch (error) {
      console.warn('[shell] Unable to remember workspace prompt dismissal', error)
    }
    document.querySelector('[data-sedifex-expand-prompt]')?.remove()
  }

  function wasDismissed() {
    try {
      return localStorage.getItem(DISMISSED_KEY) === 'true'
    } catch {
      return false
    }
  }

  function findCollapseButton() {
    return Array.from(document.querySelectorAll('.shell__nav-collapse-button')).find(button =>
      button.textContent?.toLowerCase().includes('hide navigation') ||
      button.textContent?.toLowerCase().includes('expand workspace'),
    )
  }

  function enhanceButtons() {
    const collapseButton = findCollapseButton()
    if (collapseButton && !collapseButton.hasAttribute(ENHANCED_ATTR)) {
      collapseButton.innerHTML = '<span aria-hidden="true">⛶</span><span>Expand workspace</span>'
      collapseButton.setAttribute('title', 'Hide the navigation and use the full page width')
      collapseButton.setAttribute('aria-label', 'Expand workspace by hiding navigation')
      collapseButton.setAttribute(ENHANCED_ATTR, 'true')
      collapseButton.addEventListener('click', dismissPrompt)
    }

    const showButton = document.querySelector('.shell__nav-rail-button')
    if (showButton && !showButton.hasAttribute(ENHANCED_ATTR)) {
      const label = showButton.querySelector('span:last-child')
      if (label) label.textContent = 'Show navigation'
      showButton.setAttribute('title', 'Restore the navigation sidebar')
      showButton.setAttribute(ENHANCED_ATTR, 'true')
    }
  }

  function ensurePrompt() {
    if (!isDesktop() || isCollapsed() || wasDismissed()) {
      document.querySelector('[data-sedifex-expand-prompt]')?.remove()
      return
    }

    const content = document.querySelector('.shell__content')
    const collapseButton = findCollapseButton()
    if (!content || !collapseButton || content.querySelector('[data-sedifex-expand-prompt]')) return

    const prompt = document.createElement('div')
    prompt.className = 'shell-expand-prompt'
    prompt.setAttribute('data-sedifex-expand-prompt', 'true')
    prompt.setAttribute('role', 'status')
    prompt.innerHTML = `
      <div class="shell-expand-prompt__copy">
        <strong>Need a wider view?</strong>
        <span>Expand the workspace to see more report columns and use the full screen.</span>
      </div>
      <div class="shell-expand-prompt__actions">
        <button type="button" class="button button--primary button--small" data-sedifex-expand-now>Expand workspace</button>
        <button type="button" class="button button--ghost button--small" data-sedifex-expand-dismiss>Not now</button>
      </div>
    `

    prompt.querySelector('[data-sedifex-expand-now]')?.addEventListener('click', () => {
      dismissPrompt()
      collapseButton.click()
    })
    prompt.querySelector('[data-sedifex-expand-dismiss]')?.addEventListener('click', dismissPrompt)

    const inner = content.querySelector('.shell__content-inner')
    content.insertBefore(prompt, inner || content.firstChild)
  }

  function apply() {
    if (applying) return
    applying = true
    try {
      enhanceButtons()
      ensurePrompt()
    } finally {
      applying = false
    }
  }

  const observer = new MutationObserver(() => window.requestAnimationFrame(apply))
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
  window.addEventListener('resize', apply)
  window.addEventListener('popstate', apply)
  apply()
})()
