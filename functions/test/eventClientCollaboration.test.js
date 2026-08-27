const assert = require('assert')
const {
  effectiveClientTaskState,
  visibleClientActivityIds,
} = require('../lib/eventClientCollaborationCore')
const { eventClientPortalHtml } = require('../lib/eventClientPortalPage')

assert.strictEqual(
  effectiveClientTaskState({ status: 'done', clientState: 'open' }),
  'verified',
  'official Done status must appear verified to the client',
)

assert.strictEqual(
  effectiveClientTaskState({ status: 'todo', clientState: 'verified' }),
  'open',
  'reopening an officially verified task must reopen the client state',
)

assert.strictEqual(
  effectiveClientTaskState({ status: 'in_progress', clientState: 'submitted' }),
  'submitted',
  'a live client submission should remain submitted while staff reviews it',
)

assert.deepStrictEqual(
  visibleClientActivityIds(
    [
      { taskId: 'shared-task' },
      { taskId: 'unshared-task' },
      { taskId: 'deleted-task' },
      {},
    ],
    ['shared-task'],
  ),
  [0],
  'only activity belonging to currently visible tasks may reach the public portal',
)

const html = eventClientPortalHtml({
  event: {
    title: 'Client test event',
    eventCode: 'EVT-1',
    eventDate: '2026-09-01',
    venue: 'Accra',
    clientName: 'Sandra',
  },
  brand: {
    storeName: 'Test Events',
    phone: '',
    email: 'events@example.com',
    brandColor: '#4f46e5',
  },
  tasks: [
    {
      id: 'task-1',
      title: 'Confirm guest list',
      category: 'Client',
      dueDate: '2026-08-30',
      clientState: 'open',
      clientSubmissionNote: '',
      clientStaffNote: '',
      verifiedAt: null,
    },
  ],
  activities: [],
  progress: 0,
}, 'secret-token')

assert.ok(html.includes('sessionStorage'), 'portal should persist unsent task notes')
assert.ok(html.includes('hasDirtyDraft'), 'automatic refresh must stop while any unsent draft exists')
assert.ok(html.includes('data-task-id="task-1"'), 'draft persistence must be tied to the task id')

console.log('Event client collaboration tests passed')
