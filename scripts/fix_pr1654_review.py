from pathlib import Path

# 1) Prevent Back from returning to a stale /bookings/new editor after creation.
path = Path('web/src/pages/BookingEditor.tsx')
text = path.read_text()
old = "navigate(`/bookings/${encodeURIComponent(targetId)}`)"
new = "navigate(`/bookings/${encodeURIComponent(targetId)}`, { replace: isCreateMode })"
if old not in text:
    raise SystemExit('BookingEditor target not found')
path.write_text(text.replace(old, new, 1))

# 2) Preserve the previous event/non-event destination when the schedule is empty,
# while retaining booking-only/event-only routing when entries exist.
path = Path('web/src/components/CompactBusinessDashboard.tsx')
text = path.read_text()
old = """          to: upcomingEntries.length === 1
            ? upcomingEntries[0].to
            : eventEntries.length === 0
              ? '/bookings'
              : bookingEntries.length === 0
                ? '/event-planning'
                : '/upcoming-events',
          linkLabel: upcomingEntries.length === 1
            ? (upcomingEntries[0].to.startsWith('/bookings/') ? 'Open booking' : 'Open event')
            : eventEntries.length === 0
              ? 'View bookings'
              : bookingEntries.length === 0
                ? 'View events'
                : 'View schedule',
"""
new = """          to: upcomingEntries.length === 1
            ? upcomingEntries[0].to
            : upcomingEntries.length === 0
              ? (industry === 'event' ? '/event-planning' : '/upcoming-events')
              : eventEntries.length === 0
                ? '/bookings'
                : bookingEntries.length === 0
                  ? '/event-planning'
                  : '/upcoming-events',
          linkLabel: upcomingEntries.length === 1
            ? (upcomingEntries[0].to.startsWith('/bookings/') ? 'Open booking' : 'Open event')
            : upcomingEntries.length === 0
              ? (industry === 'event' ? 'View events' : 'View schedule')
              : eventEntries.length === 0
                ? 'View bookings'
                : bookingEntries.length === 0
                  ? 'View events'
                  : 'View schedule',
"""
if old not in text:
    raise SystemExit('CompactBusinessDashboard target not found')
path.write_text(text.replace(old, new, 1))
