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
  brief: {
    requirements: 'Outdoor ceremony',
    themeColours: 'Cream and copper',
    venueRequirements: '',
    catering: '',
    decor: '',
    entertainment: '',
    photography: '',
    transport: '',
    accommodation: '',
    specialInstructions: 'Wheelchair access',
  },
  briefUpdatedAt: null,
  program: {
    status: 'approved',
    publishedAt: '2026-08-28T10:00:00.000Z',
    requireClientApproval: true,
    clientApproved: false,
    clientApprovedBy: '',
    clientApprovedAt: null,
    approvedBy: '',
    approvedAt: null,
    revision: 2,
    fingerprint: 'a'.repeat(64),
    canApprove: true,
    canRequestChanges: true,
    preparingRevision: null,
    items: [
      {
        id: 'program-1',
        time: '16:00',
        title: 'Couple entrance',
        participant: 'Couple',
        notes: 'After welcome speech',
      },
    ],
    changeRequests: [],
  },
  tasks: [
    {
      id: 'task-1',
      title: 'Confirm guest list',
      category: 'Client',
      dueDate: '2026-08-30',
      status: 'in_progress',
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
assert.ok(html.includes('I have done this'), 'client task should use a simple completion checkbox')
assert.ok(html.includes('Anything you want to tell us?'), 'client task note should be clearly optional')
assert.ok(html.includes('Send to event team'), 'client task should have one clear submission action')
assert.ok(html.includes('completeTask('), 'client completion should handle the legacy start step automatically')
assert.ok(!html.includes('Start task</button>'), 'clients should not need a separate Start task step')
assert.ok(!html.includes('I have completed this · Submit'), 'technical task submission wording should be removed')
assert.ok(html.includes('Your live event brief'), 'portal should expose the live client brief editor')
assert.ok(html.includes('data-brief-field="requirements"'), 'portal should render editable brief fields')
assert.ok(html.includes("action:'save_brief'"), 'portal should post the secure brief save action')
assert.ok(html.includes('briefDirty'), 'auto refresh must not discard unsaved brief changes')
assert.ok(html.includes('Your event program'), 'portal should display a published program as a protected document')
assert.ok(html.includes('Couple entrance'), 'portal should render published program items')
assert.ok(html.includes('Awaiting your approval'), 'published programs requiring approval should explain the pending client action')
assert.ok(html.includes('Approve program'), 'client should be able to approve when staff requires approval')
assert.ok(html.includes("action:'approve_program'"), 'client approval must use the secure portal action')
assert.ok(html.includes('fingerprint:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"'), 'client approval must be tied to the exact published content')
assert.ok(html.includes('data-program-change-request'), 'portal should offer a change request instead of direct program editing')
assert.ok(html.includes("action:'request_program_change'"), 'program change requests must use the secure portal action')
assert.ok(html.includes('programRequestDirty'), 'auto refresh must not discard an unsent program change request')
assert.ok(html.includes('role="tablist"'), 'portal should expose accessible tab navigation')
assert.ok(html.includes('data-tab-button="event"'), 'My Event tab should be rendered')
assert.ok(html.includes('data-tab-button="program"'), 'Program tab should be rendered')
assert.ok(html.includes('data-tab-button="tasks"'), 'My Tasks tab should be rendered')
assert.ok(html.includes('data-tab-button="updates"'), 'Updates tab should be rendered')
assert.ok(html.includes('function tabFromHash()'), 'selected portal tab should survive automatic page refreshes')
assert.ok(html.includes("portalTabs=['event','program','tasks','updates']"), 'portal should limit tab navigation to the four supported sections')
assert.ok(html.includes('tasks verified'), 'portal progress label must match the verified-only progress calculation')
assert.ok(!html.includes('tasks completed</span>'), 'portal must not describe verified-only progress as completed tasks')

console.log('Event client collaboration tests passed')