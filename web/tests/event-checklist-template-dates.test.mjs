import assert from 'node:assert/strict'

process.env.TZ = 'Pacific/Kiritimati'

function parseLocalDate(value) {
  if (!value) return null
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatLocalCalendarDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function taskOffsetDays(eventDate, taskDueDate) {
  const event = parseLocalDate(eventDate)
  const due = parseLocalDate(taskDueDate)
  if (!event || !due) return null
  return Math.round((due.getTime() - event.getTime()) / 86_400_000)
}

function dateFromOffset(eventDate, offsetDays) {
  if (offsetDays === null) return ''
  const event = parseLocalDate(eventDate)
  if (!event) return ''
  event.setDate(event.getDate() + offsetDays)
  return formatLocalCalendarDate(event)
}

assert.equal(taskOffsetDays('2026-12-20', '2026-11-20'), -30)
assert.equal(dateFromOffset('2027-03-15', -30), '2027-02-13')
assert.equal(taskOffsetDays('2026-12-20', '2026-12-20'), 0)
assert.equal(dateFromOffset('2027-03-15', 0), '2027-03-15')
assert.equal(taskOffsetDays('2026-12-20', '2026-12-23'), 3)
assert.equal(dateFromOffset('2027-03-15', 3), '2027-03-18')
assert.equal(taskOffsetDays('', '2026-12-20'), null)
assert.equal(dateFromOffset('', -7), '')

// UTC+14 local noon is still the previous UTC date, so toISOString() would
// incorrectly return 2027-03-14 here. The template must preserve local dates.
const localNoon = parseLocalDate('2027-03-15')
assert.equal(localNoon.toISOString().slice(0, 10), '2027-03-14')
assert.equal(dateFromOffset('2027-03-15', 0), '2027-03-15')

console.log('Reusable event checklist template date checks passed.')
