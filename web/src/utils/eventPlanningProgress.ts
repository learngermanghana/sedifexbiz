export type EventTaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done'

export type EventPlanningTask = {
  status: EventTaskStatus
}

/**
 * Readiness is derived from completed checklist items. Keeping the calculation
 * in one helper makes it deterministic for the UI, Cloud Functions and tests.
 */
export function calculateEventTaskProgress(tasks: EventPlanningTask[]): number {
  if (tasks.length === 0) return 0
  const completed = tasks.filter(task => task.status === 'done').length
  return Math.round((completed / tasks.length) * 100)
}
