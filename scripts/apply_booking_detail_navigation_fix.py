from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'{label} anchor missing')
    return text.replace(old, new, 1)


dashboard_path = Path('web/src/components/CompactBusinessDashboard.tsx')
dashboard = dashboard_path.read_text()
dashboard = replace_once(
    dashboard,
    """          to: industry === 'event' ? '/event-planning' : '/upcoming-events',
          linkLabel: 'View schedule',
""",
    """          to: upcomingEntries.length === 1
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
""",
    'dashboard upcoming route',
)
dashboard_path.write_text(dashboard)

crm_path = Path('web/src/pages/CustomerCRM.tsx')
crm = crm_path.read_text()
crm = replace_once(
    crm,
    """function isBookingLike(data: RecordMap): boolean {
""",
    """function bookingHref(row: DataRow): string {
  const canonicalBookingId = firstText(row.data, ['bookingId', 'booking_id'])
  if (canonicalBookingId) return `/bookings/${encodeURIComponent(canonicalBookingId)}`
  if (row.source === 'store' || row.source === 'root') return `/bookings/${encodeURIComponent(row.id)}`
  return '/reports/bookings'
}

function isBookingLike(data: RecordMap): boolean {
""",
    'CustomerCRM booking href helper',
)
crm = replace_once(
    crm,
    """      rows.push({ id: `booking-${row.id}`, kind: 'Booking', title: service, detail: bookingDate ? `Booked for ${bookingDate}` : 'Booking activity', date: recordDate(row.data), href: '/bookings' })
""",
    """      rows.push({ id: `booking-${row.id}`, kind: 'Booking', title: service, detail: bookingDate ? `Booked for ${bookingDate}` : 'Booking activity', date: recordDate(row.data), href: bookingHref(row) })
""",
    'CustomerCRM booking timeline',
)
crm = replace_once(
    crm,
    """            <div><span>{statusText(firstText(row.data, ['bookingStatus', 'status']))}</span><span>{statusText(firstText(row.data, ['paymentStatus', 'payment.status']), 'Payment not recorded')}</span></div>
          </article>
""",
    """            <div><span>{statusText(firstText(row.data, ['bookingStatus', 'status']))}</span><span>{statusText(firstText(row.data, ['paymentStatus', 'payment.status']), 'Payment not recorded')}</span></div>
            <Link to={bookingHref(row)}>Open booking →</Link>
          </article>
""",
    'CustomerCRM booking record action',
)
crm_path.write_text(crm)

editor_path = Path('web/src/pages/BookingEditor.tsx')
editor = editor_path.read_text()
editor = replace_once(
    editor,
    """      void playSound('success')
      navigate('/bookings')
    } catch (error) {
      console.error('[booking-editor] Failed to save booking', error)
""",
    """      void playSound('success')
      navigate(`/bookings/${encodeURIComponent(targetId)}`)
    } catch (error) {
      console.error('[booking-editor] Failed to save booking', error)
""",
    'BookingEditor post-save navigation',
)
editor_path.write_text(editor)
