import { describe, expect, test } from 'vitest'
import { calculateEventTaskProgress, type EventPlanningTask } from './eventPlanningProgress'

describe('calculateEventTaskProgress', () => {
  test('returns 0 when there are no checklist tasks', () => {
    expect(calculateEventTaskProgress([])).toBe(0)
  })

  test('counts only completed tasks toward readiness', () => {
    const tasks: EventPlanningTask[] = [
      { status: 'done' },
      { status: 'done' },
      { status: 'in_progress' },
      { status: 'blocked' },
    ]

    expect(calculateEventTaskProgress(tasks)).toBe(50)
  })

  test('rounds partial completion to a whole percentage', () => {
    const tasks: EventPlanningTask[] = [
      { status: 'done' },
      { status: 'todo' },
      { status: 'todo' },
    ]

    expect(calculateEventTaskProgress(tasks)).toBe(33)
  })

  test('returns 100 when every task is complete', () => {
    expect(calculateEventTaskProgress([
      { status: 'done' },
      { status: 'done' },
    ])).toBe(100)
  })
})
