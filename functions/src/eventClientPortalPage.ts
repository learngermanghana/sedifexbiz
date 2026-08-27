type PortalTask = {
  id: string
  title: string
  category: string
  dueDate: string
  status: string
  clientState: string
  clientSubmissionNote: string
  clientStaffNote: string
  verifiedAt: string | null
}

type PortalActivity = {
  id: string
  taskTitle: string
  note: string
  actor: string
  at: string | null
}

export type EventClientPortalPageData = {
  event: {
    title: string
    eventCode: string
    eventDate: string
    venue: string
    clientName: string
  }
  brand: {
    storeName: string
    phone: string
    email: string
    brandColor: string
  }
  tasks: PortalTask[]
  activities: PortalActivity[]
  progress: number
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function safeColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : '#2d7b50'
}

function stateLabel(task: PortalTask) {
  if (task.clientState === 'verified' || task.status === 'done') return 'Done'
  if (task.clientState === 'submitted') return 'Submitted by client'
  if (task.clientState === 'changes_requested') return 'Changes requested'
  if (task.status === 'in_progress') return 'In progress'
  return 'To do'
}

function stateClass(task: PortalTask) {
  if (task.clientState === 'verified' || task.status === 'done') return 'verified'
  if (task.clientState === 'submitted') return 'submitted'
  if (task.clientState === 'changes_requested') return 'changes_requested'
  if (task.status === 'in_progress') return 'in_progress'
  return 'open'
}

function formatDateTime(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function eventClientPortalHtml(data: EventClientPortalPageData, token: string) {
  const brandColor = safeColor(data.brand.brandColor)
  const taskHtml = data.tasks.length
    ? data.tasks.map(task => {
      const verified = task.clientState === 'verified' || task.status === 'done'
      const submitted = task.clientState === 'submitted'
      const todo = !verified && !submitted && task.status === 'todo'
      const changesRequested = task.clientState === 'changes_requested'
      const actionHtml = verified
        ? `<p class="muted">Done${task.verifiedAt ? ` · Verified ${escapeHtml(formatDateTime(task.verifiedAt))}` : ''}</p>`
        : submitted
          ? '<div class="waiting"><strong>Awaiting verification</strong><p>The event team has received your completion update. They will verify it or return it with a note.</p></div>'
          : todo
            ? `<button type="button" onclick="startTask('${escapeHtml(task.id)}')">Start task</button>`
            : `<textarea id="note-${escapeHtml(task.id)}" data-task-id="${escapeHtml(task.id)}" placeholder="Add a note or confirmation for the event team…"></textarea><button type="button" onclick="submitTask('${escapeHtml(task.id)}')">${changesRequested ? 'Resubmit completed task' : 'I have completed this · Submit'}</button>`
      return `<article class="task">
        <div class="task-top"><div><h3>${escapeHtml(task.title)}</h3><p class="task-meta">${escapeHtml(task.category)}${task.dueDate ? ` · Due ${escapeHtml(task.dueDate)}` : ''}</p></div><span class="state ${escapeHtml(stateClass(task))}">${escapeHtml(stateLabel(task))}</span></div>
        ${task.clientStaffNote ? `<div class="staff-note"><strong>Event team:</strong> ${escapeHtml(task.clientStaffNote)}</div>` : ''}
        ${task.clientSubmissionNote ? `<div class="client-note"><strong>Your last submission:</strong> ${escapeHtml(task.clientSubmissionNote)}</div>` : ''}
        ${actionHtml}
      </article>`
    }).join('')
    : '<div class="empty">Your event team has not assigned any client tasks yet.</div>'

  const activityHtml = data.activities.length
    ? data.activities.map(item => `<div class="activity-item"><strong>${escapeHtml(item.taskTitle || 'Event update')}</strong><p>${escapeHtml(item.actor || 'Update')}${item.at ? ` · ${escapeHtml(formatDateTime(item.at))}` : ''}</p>${item.note ? `<p>${escapeHtml(item.note)}</p>` : ''}</div>`).join('')
    : '<p class="muted">No client activity yet.</p>'

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Event client portal · Sedifex</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17211d;background:#f5f7f5}*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#f7faf8 0,#eef4f0 100%);min-height:100vh}.shell{max-width:920px;margin:0 auto;padding:28px 18px 70px}.hero,.card{background:#fff;border:1px solid #dfe8e2;border-radius:20px;box-shadow:0 16px 50px rgba(20,35,26,.07)}.hero{padding:26px;margin-bottom:18px}.eyebrow{font-size:.75rem;font-weight:850;letter-spacing:.08em;text-transform:uppercase;color:#658071;margin:0 0 6px}.hero h1{margin:0;font-size:clamp(1.7rem,5vw,2.6rem);letter-spacing:-.035em}.hero p{color:#617066;line-height:1.6}.meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}.pill{padding:7px 10px;border-radius:999px;background:#edf7f1;color:#326145;font-weight:760;font-size:.78rem}.workflow{margin-top:14px;padding:10px 12px;border-radius:12px;background:#f5f3ff;color:#4c1d95;font-size:.78rem;font-weight:800;line-height:1.5}.progress{display:flex;align-items:center;gap:12px;margin-top:18px}.progress-track{height:9px;background:#e7eee9;border-radius:999px;overflow:hidden;flex:1}.progress-track i{display:block;height:100%;background:${brandColor}}.layout{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:18px}.card{padding:20px}.card h2{margin:0 0 5px;font-size:1.2rem}.muted{color:#6b7a70;font-size:.86rem;line-height:1.55}.tasks{display:grid;gap:12px;margin-top:16px}.task{border:1px solid #dfe8e2;border-radius:16px;padding:16px;background:#fbfdfb}.task-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.task h3{margin:0;font-size:1rem}.task-meta{font-size:.76rem;color:#748278;margin:5px 0 0}.state{white-space:nowrap;padding:5px 8px;border-radius:999px;font-size:.68rem;font-weight:850;background:#eef2ff;color:#4338ca}.state.in_progress{background:#eff6ff;color:#1d4ed8}.state.submitted{background:#fff7ed;color:#c2410c}.state.changes_requested{background:#fff1f2;color:#be123c}.state.verified{background:#ecfdf5;color:#166534}.staff-note{padding:10px 11px;border-radius:10px;background:#fff7ed;color:#9a3412;font-size:.8rem;margin-top:10px}.client-note{padding:10px 11px;border-radius:10px;background:#f3f6f4;color:#53665a;font-size:.8rem;margin-top:10px}.waiting{margin-top:12px;padding:11px 12px;border-radius:11px;background:#fff7ed;color:#9a3412}.waiting strong{font-size:.82rem}.waiting p{margin:4px 0 0;font-size:.78rem;line-height:1.5}.task textarea{width:100%;min-height:76px;margin-top:12px;border:1px solid #cdd8d1;border-radius:10px;padding:10px;font:inherit;resize:vertical}.task button{border:0;border-radius:10px;padding:10px 13px;background:${brandColor};color:#fff;font:inherit;font-size:.82rem;font-weight:800;cursor:pointer;margin-top:10px}.activity{display:grid;gap:10px;margin-top:14px}.activity-item{border-top:1px solid #e7ece8;padding-top:10px}.activity-item:first-child{border-top:0;padding-top:0}.activity-item strong{font-size:.8rem}.activity-item p{font-size:.76rem;color:#65746a;margin:3px 0}.empty{padding:20px;border:1px dashed #cfd9d2;border-radius:14px;text-align:center;color:#6b7a70}.brand{font-weight:900;color:${brandColor}}@media(max-width:760px){.layout{grid-template-columns:1fr}.shell{padding:16px 12px 50px}.hero,.card{border-radius:16px}.task-top{flex-direction:column}.state{white-space:normal}}
</style></head><body><main class="shell">
<section class="hero"><p class="eyebrow"><span class="brand">${escapeHtml(data.brand.storeName)}</span> · Client collaboration</p><h1>${escapeHtml(data.event.title)}</h1><p>Hello ${escapeHtml(data.event.clientName)}. Work through the planning items shared with you. Your event team verifies every completed task before it becomes officially done.</p><div class="workflow">To do → In progress → Submitted by client → Awaiting verification → Done</div><div class="meta">${data.event.eventCode ? `<span class="pill">${escapeHtml(data.event.eventCode)}</span>` : ''}${data.event.eventDate ? `<span class="pill">${escapeHtml(data.event.eventDate)}</span>` : ''}${data.event.venue ? `<span class="pill">${escapeHtml(data.event.venue)}</span>` : ''}</div><div class="progress"><strong>${data.progress}%</strong><div class="progress-track"><i style="width:${data.progress}%"></i></div><span class="muted">verified</span></div></section>
<div class="layout"><section class="card"><h2>Your tasks</h2><p class="muted">Start a task when you begin it. When it is complete, submit it to the event team for verification.</p><div class="tasks">${taskHtml}</div></section><aside class="card"><h2>Activity</h2><p class="muted">Updates from you and the event team appear here.</p><div class="activity">${activityHtml}</div></aside></div>
</main><script>
var portalToken=${JSON.stringify(token)};var submitting=false;
function draftKey(taskId){return 'sedifex:event-client-draft:'+portalToken+':'+taskId}
function setupDrafts(){document.querySelectorAll('textarea[data-task-id]').forEach(function(area){var taskId=area.getAttribute('data-task-id')||'';var saved='';try{saved=sessionStorage.getItem(draftKey(taskId))||''}catch(_error){}if(saved&&!area.value)area.value=saved;area.addEventListener('input',function(){try{if(area.value)sessionStorage.setItem(draftKey(taskId),area.value);else sessionStorage.removeItem(draftKey(taskId))}catch(_error){}})})}
function hasDirtyDraft(){return Array.prototype.some.call(document.querySelectorAll('textarea[data-task-id]'),function(area){return Boolean(area.value&&area.value.trim())})}
async function postTaskAction(action,taskId,note){if(submitting)return false;submitting=true;try{var response=await fetch(location.pathname+'?token='+encodeURIComponent(portalToken),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:action,token:portalToken,taskId:taskId,note:note||''})});var payload=await response.json().catch(function(){return{}});if(!response.ok)throw new Error(payload.error||'Could not update this task.');return true}catch(error){alert(error.message||'Could not update this task.');return false}finally{submitting=false}}
async function startTask(taskId){var ok=await postTaskAction('start',taskId,'');if(ok)location.reload()}
async function submitTask(taskId){var note=document.getElementById('note-'+taskId);var ok=await postTaskAction('submit',taskId,note?note.value:'');if(ok){try{sessionStorage.removeItem(draftKey(taskId))}catch(_error){}location.reload()}}
setupDrafts();
setInterval(function(){var active=document.activeElement;var editing=active&&active.tagName==='TEXTAREA';if(!editing&&!hasDirtyDraft()&&!submitting)location.reload()},5000);
</script></body></html>`
}
