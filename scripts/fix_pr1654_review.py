from pathlib import Path

# 1) Prevent Back from returning to a stale /bookings/new editor after creation.
path = Path('web/src/pages/BookingEditor.tsx')
text = path.read_text()
old = "navigate(`/bookings/${encodeURIComponent(targetId)}`)"
new = "navigate(`/bookings/${encodeURIComponent(targetId)}`, { replace: !bookingId })"
if old not in text:
    raise SystemExit('BookingEditor target not found')
path.write_text(text.replace(old, new, 1))

# 2) Preserve event-business destination when the schedule is empty.
path = Path('web/src/components/CompactBusinessDashboard.tsx')
text = path.read_text()
old = """          const scheduleFooterHref = bookingEntries.length === 0
            ? '/upcoming-events'
            : eventEntries.length === 0
              ? '/bookings'
              : industry === 'events'
                ? '/upcoming-events'
                : '/bookings'
          const scheduleFooterLabel = bookingEntries.length === 0
            ? 'View events'
            : eventEntries.length === 0
              ? 'View bookings'
              : industry === 'events'
                ? 'View events'
                : 'View bookings'
"""
new = """          const hasBookings = bookingEntries.length > 0
          const hasEvents = eventEntries.length > 0
          const scheduleFooterHref = !hasBookings && !hasEvents
            ? (industry === 'events' ? '/upcoming-events' : '/bookings')
            : !hasBookings
              ? '/upcoming-events'
              : !hasEvents
                ? '/bookings'
                : industry === 'events'
                  ? '/upcoming-events'
                  : '/bookings'
          const scheduleFooterLabel = !hasBookings && !hasEvents
            ? (industry === 'events' ? 'View events' : 'View bookings')
            : !hasBookings
              ? 'View events'
              : !hasEvents
                ? 'View bookings'
                : industry === 'events'
                  ? 'View events'
                  : 'View bookings'
"""
if old not in text:
    raise SystemExit('CompactBusinessDashboard target not found')
path.write_text(text.replace(old, new, 1))
