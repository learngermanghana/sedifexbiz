export type ClientTaskState = 'open' | 'submitted' | 'changes_requested' | 'verified'

type RecordMap = Record<string, unknown>

function text(value: unknown, max = 5000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function clientTaskState(value: unknown): ClientTaskState {
  return ['submitted', 'changes_requested', 'verified'].includes(String(value))
    ? value as ClientTaskState
    : 'open'
}

/**
 * The official checklist status is authoritative. Client collaboration state
 * adds workflow detail, but it must never contradict a staff status change.
 */
export function effectiveClientTaskState(data: RecordMap): ClientTaskState {
  const status = text(data.status, 40) || 'todo'
  const clientState = clientTaskState(data.clientState)

  if (status === 'done') return 'verified'

  // Staff may reopen a task through the ordinary checklist status control.
  // A stale collaboration value must not keep that reopened task verified.
  if (clientState === 'verified') return 'open'

  // Client submissions move the official task to in_progress. If staff later
  // explicitly moves it back to To do, treat that as a reopened client task.
  if (status === 'todo' && clientState === 'submitted') return 'open'

  return clientState
}

export function visibleClientActivityIds(
  activities: Array<{ taskId?: unknown }>,
  visibleTaskIds: Iterable<string>,
) {
  const visible = new Set(visibleTaskIds)
  return activities
    .map((activity, index) => ({ index, taskId: text(activity.taskId, 220) }))
    .filter(item => item.taskId && visible.has(item.taskId))
    .map(item => item.index)
}
