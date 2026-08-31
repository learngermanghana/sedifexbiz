# Booking navigation regressions

PR #1654 must preserve these behaviors:

1. Saving from `/bookings/new` replaces the create-route history entry when opening the newly created booking detail, so Back cannot reopen a stale populated create form and create a duplicate.
2. Editing an existing booking opens its detail route without replacing normal history.
3. When the dashboard schedule is empty, event-industry stores keep the Event Planning destination and other industries keep the general Upcoming Schedule destination.
4. When schedule entries exist, booking-only schedules go to Bookings, event-only schedules go to Event Planning, and a single entry opens that entry directly.
