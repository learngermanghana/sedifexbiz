from pathlib import Path

path = Path('web/src/components/CompactBusinessDashboard.tsx')
text = path.read_text()

old_events = """  const eventEntries = events
    .map(item => ({
      id: pickText(item, ['id'], eventTitle(item)),
      title: eventTitle(item),
      customer: pickText(item, ['clientName', 'customerName'], 'Client'),
      date: eventDate(item),
      status: normalizeStatus(item.status),
      openTasks: openClientTaskCount(item),
      to: `/event-planning/${pickText(item, ['id'], '')}`,
    }))
    .filter(item => item.date && item.date >= today && !['cancelled', 'completed'].includes(item.status))

  const upcomingEntries = [...bookingEntries, ...eventEntries]
    .sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0))

  const pendingClientTasks = events.reduce((sum, item) => sum + openClientTaskCount(item), 0)
"""

new_events = """  const allEventEntries = events.map(item => ({
    id: pickText(item, ['id'], eventTitle(item)),
    title: eventTitle(item),
    customer: pickText(item, ['clientName', 'customerName'], 'Client'),
    date: eventDate(item),
    status: normalizeStatus(item.status),
    openTasks: openClientTaskCount(item),
    to: `/event-planning/${pickText(item, ['id'], '')}`,
  }))

  const eventEntries = allEventEntries
    .filter(item => item.date && item.date >= today && !['cancelled', 'completed'].includes(item.status))

  const clientTaskEntries = allEventEntries
    .filter(item => !['cancelled', 'completed'].includes(item.status) && item.openTasks > 0)
    .sort((a, b) => (a.date?.getTime() ?? Number.POSITIVE_INFINITY) - (b.date?.getTime() ?? Number.POSITIVE_INFINITY))

  const upcomingEntries = [...bookingEntries, ...eventEntries]
    .sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0))

  const pendingClientTasks = clientTaskEntries.reduce((sum, item) => sum + item.openTasks, 0)
"""

if old_events not in text:
    raise SystemExit('Event entry block not found; refusing unsafe patch')
text = text.replace(old_events, new_events, 1)

old_attention = "...eventEntries.filter(item => item.openTasks > 0).slice(0, 2).map(item => ({ id: `event-${item.id}`, title: `${item.title} has open tasks`, meta: `${item.customer} · ${item.openTasks} pending`, to: item.to, tone: 'warning' as const })),"
new_attention = "...clientTaskEntries.slice(0, 2).map(item => ({ id: `event-${item.id}`, title: `${item.title} has open tasks`, meta: `${item.customer} · ${item.openTasks} pending`, to: item.to, tone: 'warning' as const })),"
if old_attention not in text:
    raise SystemExit('Needs-attention event task row not found; refusing unsafe patch')
text = text.replace(old_attention, new_attention, 1)

old_widget_rows = "items: eventEntries.filter(item => item.openTasks > 0).slice(0, 3).map(item => ({ id: item.id, title: item.title, meta: `${item.customer} · ${formatCompactDate(item.date)}`, value: `${item.openTasks} open`, to: item.to, tone: 'warning' })),"
new_widget_rows = "items: clientTaskEntries.slice(0, 3).map(item => ({ id: item.id, title: item.title, meta: `${item.customer} · ${formatCompactDate(item.date)}`, value: `${item.openTasks} open`, to: item.to, tone: 'warning' })),"
if old_widget_rows not in text:
    raise SystemExit('Pending client task widget rows not found; refusing unsafe patch')
text = text.replace(old_widget_rows, new_widget_rows, 1)

old_move = """  function moveWidget(id: WidgetId, direction: -1 | 1) {
    setSelectedWidgetIds(current => {
      const index = current.indexOf(id)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current
      return reorder(current, index, nextIndex)
    })
  }
"""

new_move = """  function moveWidget(id: WidgetId, direction: -1 | 1) {
    const index = selectedWidgetIds.indexOf(id)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= selectedWidgetIds.length) return

    const next = reorder(selectedWidgetIds, index, nextIndex)
    setSelectedWidgetIds(next)
    if (!isCustomizing) void persistLayout(next, false)
  }
"""

if old_move not in text:
    raise SystemExit('moveWidget block not found; refusing unsafe patch')
text = text.replace(old_move, new_move, 1)

path.write_text(text)
