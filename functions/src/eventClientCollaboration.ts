import * as functions from 'firebase-functions/v1'
import { randomBytes } from 'crypto'
import { admin, defaultDb } from './firestore'
import { sendEventContractEmail } from './eventContractEmail'
import { hashPublicContractToken } from './eventContractSigningCore'

type RecordMap = Record<string, unknown>
type ClientTaskState = 'open' | 'submitted' | 'changes_requested' | 'verified'

type ClientPortalLink = {
  storeId: string
  eventId: string
  recipientName: string
  recipientEmail: string
  status: 'active' | 'revoked'
  expiresAt: FirebaseFirestore.Timestamp
  brandSnapshot: RecordMap
}

const LINK_LIFETIME_DAYS = 180

function text(value: unknown, max = 5000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function email(value: unknown) {
  const valueText = text(value, 220).toLowerCase()
  return valueText.includes('@') ? valueText : ''
}

function record(value: unknown): RecordMap {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordMap : {}
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function isoDate(value: unknown) {
  if (value instanceof admin.firestore.Timestamp) return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value === 'object' && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString()
  }
  return null
}

function escapeHtml(value: unknown) {
  return text(value, 20000)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function createToken() {
  return randomBytes(32).toString('base64url')
}

async function assertStoreAccess(storeId: string, uid: string) {
  const [storeSnapshot, memberSnapshot] = await Promise.all([
    defaultDb.collection('stores').doc(storeId).get(),
    defaultDb.collection('teamMembers').doc(uid).get(),
  ])
  if (!storeSnapshot.exists) throw new functions.https.HttpsError('not-found', 'Store not found')
  const storeData = storeSnapshot.data() as RecordMap
  const memberData = memberSnapshot.exists ? memberSnapshot.data() as RecordMap : {}
  const direct = text(memberData.uid, 220) === uid && text(memberData.storeId, 180) === storeId
  const linkedOwner = text(memberData.uid, 220) === uid
    && text(memberData.role, 40) === 'owner'
    && Boolean(text(memberData.storeId, 180))
    && text(storeData.parentStoreId, 180) === text(memberData.storeId, 180)
  const ownerUid = text(storeData.ownerUid, 220) === uid
  if (!direct && !linkedOwner && !ownerUid) {
    throw new functions.https.HttpsError('permission-denied', 'You do not have access to this event')
  }
  return storeData
}

function brandSnapshot(storeData: RecordMap) {
  return {
    storeName: text(storeData.displayName, 160) || text(storeData.businessName, 160) || text(storeData.name, 160) || 'Sedifex Store',
    email: email(storeData.email) || email(storeData.ownerEmail) || email(storeData.firstSignupEmail),
    phone: text(storeData.phone, 80),
    logoUrl: text(storeData.logoUrl, 900),
    brandColor: text(storeData.brandColor, 40) || '#4f46e5',
  }
}

function functionPortalBaseUrl() {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || ''
  const region = process.env.FUNCTION_REGION || 'us-central1'
  if (!projectId) throw new functions.https.HttpsError('internal', 'Client portal URL is not configured')
  return `https://${region}-${projectId}.cloudfunctions.net/eventClientPortal`
}

async function loadPortalLink(rawToken: string) {
  const token = text(rawToken, 300)
  if (!token) throw new Error('INVALID_LINK')
  const hash = hashPublicContractToken(token)
  const linkRef = defaultDb.collection('eventClientLinks').doc(hash)
  const linkSnapshot = await linkRef.get()
  if (!linkSnapshot.exists) throw new Error('INVALID_LINK')
  const link = linkSnapshot.data() as unknown as ClientPortalLink
  if (link.status !== 'active') throw new Error('LINK_REVOKED')
  if (!link.expiresAt?.toMillis || link.expiresAt.toMillis() < Date.now()) throw new Error('LINK_EXPIRED')
  const eventRef = defaultDb.collection('stores').doc(link.storeId).collection('events').doc(link.eventId)
  const eventSnapshot = await eventRef.get()
  if (!eventSnapshot.exists) throw new Error('EVENT_NOT_FOUND')
  const eventData = eventSnapshot.data() as RecordMap
  const clientPortal = record(eventData.clientPortal)
  if (text(clientPortal.publicLinkHash, 100) !== hash || text(clientPortal.status, 40) !== 'active') throw new Error('LINK_REVOKED')
  return { token, hash, linkRef, link, eventRef, eventSnapshot, eventData }
}

function taskState(value: unknown): ClientTaskState {
  return ['submitted', 'changes_requested', 'verified'].includes(String(value)) ? value as ClientTaskState : 'open'
}

async function portalData(rawToken: string) {
  const loaded = await loadPortalLink(rawToken)
  const [taskSnapshot, activitySnapshot] = await Promise.all([
    loaded.eventRef.collection('tasks').get(),
    loaded.eventRef.collection('clientActivity').orderBy('at', 'desc').limit(30).get(),
  ])
  const tasks = taskSnapshot.docs
    .filter(item => item.data().clientVisible === true)
    .map(item => {
      const data = item.data() as RecordMap
      return {
        id: item.id,
        title: text(data.title, 240) || 'Event task',
        category: text(data.category, 100) || 'General',
        dueDate: text(data.dueDate, 40),
        priority: text(data.priority, 40) || 'normal',
        status: text(data.status, 40) || 'todo',
        clientState: taskState(data.clientState),
        clientSubmissionNote: text(data.clientSubmissionNote, 3000),
        clientStaffNote: text(data.clientStaffNote, 3000),
        submittedAt: isoDate(data.clientSubmittedAt),
        verifiedAt: isoDate(data.clientVerifiedAt),
        sortOrder: numberValue(data.sortOrder),
      }
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))

  const activities = activitySnapshot.docs.map(item => {
    const data = item.data() as RecordMap
    return {
      id: item.id,
      type: text(data.type, 80),
      taskTitle: text(data.taskTitle, 240),
      note: text(data.note, 3000),
      actor: text(data.actor, 180),
      at: isoDate(data.at),
    }
  })
  const brand = record(loaded.link.brandSnapshot)
  const visibleDone = tasks.filter(item => item.clientState === 'verified').length
  return {
    ok: true,
    event: {
      title: text(loaded.eventData.title, 220) || text(loaded.eventData.eventType, 160) || 'Event',
      eventCode: text(loaded.eventData.eventCode, 80),
      eventDate: text(loaded.eventData.eventDate, 40),
      venue: text(loaded.eventData.venue, 220),
      clientName: text(loaded.eventData.clientName, 180) || loaded.link.recipientName || 'Client',
    },
    brand: {
      storeName: text(brand.storeName, 180) || 'Event team',
      phone: text(brand.phone, 80),
      email: email(brand.email),
      brandColor: text(brand.brandColor, 40) || '#4f46e5',
    },
    tasks,
    activities,
    progress: tasks.length ? Math.round(visibleDone / tasks.length * 100) : 0,
    expiresAt: isoDate(loaded.link.expiresAt),
  }
}

function portalHtml() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Event client portal · Sedifex</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17211d;background:#f5f7f5}*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#f7faf8 0,#eef4f0 100%);min-height:100vh}.shell{max-width:920px;margin:0 auto;padding:28px 18px 70px}.hero,.card{background:#fff;border:1px solid #dfe8e2;border-radius:20px;box-shadow:0 16px 50px rgba(20,35,26,.07)}.hero{padding:26px;margin-bottom:18px}.eyebrow{font-size:.75rem;font-weight:850;letter-spacing:.08em;text-transform:uppercase;color:#658071;margin:0 0 6px}.hero h1{margin:0;font-size:clamp(1.7rem,5vw,2.6rem);letter-spacing:-.035em}.hero p{color:#617066;line-height:1.6}.meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}.pill{padding:7px 10px;border-radius:999px;background:#edf7f1;color:#326145;font-weight:760;font-size:.78rem}.progress{display:flex;align-items:center;gap:12px;margin-top:18px}.progress-track{height:9px;background:#e7eee9;border-radius:999px;overflow:hidden;flex:1}.progress-track i{display:block;height:100%;background:#2d7b50}.layout{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:18px}.card{padding:20px}.card h2{margin:0 0 5px;font-size:1.2rem}.muted{color:#6b7a70;font-size:.86rem;line-height:1.55}.tasks{display:grid;gap:12px;margin-top:16px}.task{border:1px solid #dfe8e2;border-radius:16px;padding:16px;background:#fbfdfb}.task-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.task h3{margin:0;font-size:1rem}.task-meta{font-size:.76rem;color:#748278;margin:5px 0 0}.state{white-space:nowrap;padding:5px 8px;border-radius:999px;font-size:.68rem;font-weight:850;background:#eef2ff;color:#4338ca}.state.submitted{background:#fff7ed;color:#c2410c}.state.changes_requested{background:#fff1f2;color:#be123c}.state.verified{background:#ecfdf5;color:#166534}.staff-note{padding:10px 11px;border-radius:10px;background:#fff7ed;color:#9a3412;font-size:.8rem;margin-top:10px}.client-note{padding:10px 11px;border-radius:10px;background:#f3f6f4;color:#53665a;font-size:.8rem;margin-top:10px}.task textarea{width:100%;min-height:76px;margin-top:12px;border:1px solid #cdd8d1;border-radius:10px;padding:10px;font:inherit;resize:vertical}.task button,.refresh{border:0;border-radius:10px;padding:10px 13px;background:#2d7b50;color:#fff;font:inherit;font-size:.82rem;font-weight:800;cursor:pointer;margin-top:8px}.task button:disabled{opacity:.55;cursor:not-allowed}.activity{display:grid;gap:10px;margin-top:14px}.activity-item{border-top:1px solid #e7ece8;padding-top:10px}.activity-item:first-child{border-top:0;padding-top:0}.activity-item strong{font-size:.8rem}.activity-item p{font-size:.76rem;color:#65746a;margin:3px 0}.empty{padding:20px;border:1px dashed #cfd9d2;border-radius:14px;text-align:center;color:#6b7a70}.alert{padding:12px;border-radius:12px;background:#fff1f2;color:#9f1239;margin-bottom:14px}.brand{font-weight:900;color:#2d7b50}.loading{padding:50px 10px;text-align:center;color:#64748b}@media(max-width:760px){.layout{grid-template-columns:1fr}.shell{padding:16px 12px 50px}.hero,.card{border-radius:16px}.task-top{flex-direction:column}.state{white-space:normal}}
</style></head><body><main class="shell"><div id="root" class="loading">Loading your event tasks…</div></main>
<script>
const qs=new URLSearchParams(location.search);const token=qs.get('token')||'';const root=document.getElementById('root');let sending=false;
const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const stateLabel=(s)=>({open:'To do',submitted:'Submitted · awaiting verification',changes_requested:'Changes requested',verified:'Verified done'}[s]||'To do');
const fmt=(v)=>{if(!v)return'';const d=new Date(v);return Number.isNaN(d.getTime())?v:d.toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})};
async function callJson(url,options){const r=await fetch(url,options);const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'Request failed');return data}
function render(data){const e=data.event,b=data.brand;document.documentElement.style.setProperty('--brand',b.brandColor||'#2d7b50');const tasks=data.tasks||[];const activities=data.activities||[];root.className='';root.innerHTML=`<section class="hero"><p class="eyebrow"><span class="brand">${esc(b.storeName)}</span> · Client collaboration</p><h1>${esc(e.title)}</h1><p>Hello ${esc(e.clientName)}. Use this page to complete the planning items your event team has assigned to you. Your team verifies every item before it becomes officially done.</p><div class="meta">${e.eventCode?`<span class="pill">${esc(e.eventCode)}</span>`:''}${e.eventDate?`<span class="pill">${esc(e.eventDate)}</span>`:''}${e.venue?`<span class="pill">${esc(e.venue)}</span>`:''}</div><div class="progress"><strong>${data.progress}%</strong><div class="progress-track"><i style="width:${data.progress}%"></i></div><span class="muted">verified</span></div></section><div class="layout"><section class="card"><h2>Your tasks</h2><p class="muted">Submit a task when you believe it is complete. The event team will verify it or return it with a note.</p><div class="tasks">${tasks.length?tasks.map(t=>`<article class="task"><div class="task-top"><div><h3>${esc(t.title)}</h3><p class="task-meta">${esc(t.category)}${t.dueDate?` · Due ${esc(t.dueDate)}`:''}</p></div><span class="state ${esc(t.clientState)}">${esc(stateLabel(t.clientState))}</span></div>${t.clientStaffNote?`<div class="staff-note"><strong>Event team:</strong> ${esc(t.clientStaffNote)}</div>`:''}${t.clientSubmissionNote?`<div class="client-note"><strong>Your last submission:</strong> ${esc(t.clientSubmissionNote)}</div>`:''}${t.clientState==='verified'?`<p class="muted">Verified ${esc(fmt(t.verifiedAt))}</p>`:`<textarea id="note-${esc(t.id)}" placeholder="Add a note, details, filename or confirmation for the event team…"></textarea><button type="button" data-submit="${esc(t.id)}">${t.clientState==='submitted'?'Resubmit update':'I have completed this · Submit'}</button>`}</article>`).join(''):`<div class="empty">Your event team has not assigned any client tasks yet.</div>`}</div></section><aside class="card"><h2>Activity</h2><p class="muted">Updates from you and the event team appear here.</p><div class="activity">${activities.length?activities.map(a=>`<div class="activity-item"><strong>${esc(a.taskTitle||'Event update')}</strong><p>${esc(a.actor||'Update')} · ${esc(fmt(a.at))}</p>${a.note?`<p>${esc(a.note)}</p>`:''}</div>`).join(''):`<p class="muted">No client activity yet.</p>`}</div></aside></div>`;document.querySelectorAll('[data-submit]').forEach(btn=>btn.addEventListener('click',()=>submitTask(btn.dataset.submit)))}
async function load(){if(!token){root.innerHTML='<div class="alert">This client link is incomplete.</div>';return}try{const data=await callJson(location.pathname+'?json=1&token='+encodeURIComponent(token));render(data)}catch(e){root.innerHTML='<div class="alert">'+esc(e.message||'This client link is no longer available.')+'</div>'}}
async function submitTask(taskId){if(sending)return;const note=document.getElementById('note-'+taskId)?.value||'';sending=true;try{await callJson(location.pathname+'?token='+encodeURIComponent(token),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'submit',token,taskId,note})});await load()}catch(e){alert(e.message||'Could not submit this task.')}finally{sending=false}}
load();setInterval(()=>{if(!document.hidden&&!sending)load()},4000);
</script></body></html>`
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'LINK_EXPIRED') return 'This client portal link has expired. Ask the event team to share a new link.'
  if (message === 'LINK_REVOKED') return 'This client portal link is no longer active. Ask the event team for the latest link.'
  if (message === 'EVENT_NOT_FOUND') return 'This event is no longer available.'
  return 'This client portal link is invalid or no longer available.'
}

export const shareEventClientPortal = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  const storeId = text(data?.storeId, 180)
  const eventId = text(data?.eventId, 220)
  if (!storeId || !eventId) throw new functions.https.HttpsError('invalid-argument', 'storeId and eventId are required')

  const storeData = await assertStoreAccess(storeId, context.auth.uid)
  const eventRef = defaultDb.collection('stores').doc(storeId).collection('events').doc(eventId)
  const [eventSnapshot, visibleTasks] = await Promise.all([
    eventRef.get(),
    eventRef.collection('tasks').where('clientVisible', '==', true).get(),
  ])
  if (!eventSnapshot.exists) throw new functions.https.HttpsError('not-found', 'Event not found')
  if (visibleTasks.empty) throw new functions.https.HttpsError('failed-precondition', 'Choose at least one client-visible checklist task before sharing the portal')
  const eventData = eventSnapshot.data() as RecordMap
  const recipientEmail = email(eventData.clientEmail)
  const recipientName = text(eventData.clientName, 180) || 'Client'
  if (!recipientEmail) throw new functions.https.HttpsError('failed-precondition', 'Add the client email before sharing the checklist')

  const token = createToken()
  const tokenHash = hashPublicContractToken(token)
  const portalUrl = `${functionPortalBaseUrl()}?token=${encodeURIComponent(token)}`
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + LINK_LIFETIME_DAYS * 86400000)
  const linkRef = defaultDb.collection('eventClientLinks').doc(tokenHash)
  const previousPortal = record(eventData.clientPortal)
  const previousHash = text(previousPortal.publicLinkHash, 100)
  const previousRef = previousHash ? defaultDb.collection('eventClientLinks').doc(previousHash) : null
  const now = admin.firestore.FieldValue.serverTimestamp()
  const brand = brandSnapshot(storeData)

  await defaultDb.runTransaction(async transaction => {
    const current = await transaction.get(eventRef)
    if (!current.exists) throw new functions.https.HttpsError('not-found', 'Event not found')
    if (previousRef && previousHash !== tokenHash) transaction.set(previousRef, { status: 'revoked', revokedAt: now }, { merge: true })
    transaction.set(linkRef, {
      storeId,
      eventId,
      recipientName,
      recipientEmail,
      status: 'active',
      expiresAt,
      brandSnapshot: brand,
      createdAt: now,
      updatedAt: now,
      createdBy: context.auth?.uid || null,
    })
    transaction.update(eventRef, {
      clientPortal: {
        status: 'active',
        publicLinkHash: tokenHash,
        publicUrl: portalUrl,
        expiresAt,
        sharedAt: now,
        sharedBy: context.auth?.uid || null,
      },
      updatedAt: now,
    })
  })

  const delivery = await sendEventContractEmail({
    storeId,
    eventType: 'event.client_portal_shared',
    reference: `${eventId}-client-portal-${tokenHash.slice(0, 12)}`,
    recipientType: 'customer',
    to: recipientEmail,
    subject: `Your event planning checklist - ${text(brand.storeName, 180) || 'Event team'}`,
    title: 'Your event planning checklist is ready',
    intro: `Hello ${recipientName}, your event team has shared planning tasks with you. Open the secure client portal to review your items, send updates and submit completed tasks for verification.`,
    brand: {
      storeName: text(brand.storeName, 180) || 'Event team',
      email: email(brand.email),
      phone: text(brand.phone, 80),
      logoUrl: text(brand.logoUrl, 900),
      brandColor: text(brand.brandColor, 40) || '#4f46e5',
    },
    rows: [
      ['Event', text(eventData.title, 180) || text(eventData.eventType, 140) || 'Event'],
      ['Client tasks', String(visibleTasks.size)],
    ],
    primaryAction: { label: 'Open client checklist', url: portalUrl },
    footerNote: `Your event team verifies each submitted task before it is marked done. This secure link expires in ${LINK_LIFETIME_DAYS} days.`,
    customer: { name: recipientName, email: recipientEmail, phone: text(eventData.clientPhone, 80) },
    data: { eventId, portalUrl, clientTaskCount: visibleTasks.size },
  })

  return { ok: true, portalUrl, expiresAt: expiresAt.toDate().toISOString(), deliveries: delivery.ok ? 1 : 0 }
})

export const eventClientPortal = functions.https.onRequest(async (req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0')
  res.set('X-Content-Type-Options', 'nosniff')
  const rawToken = text(req.method === 'POST' ? req.body?.token : req.query.token, 300)

  try {
    if (req.method === 'POST') {
      const action = text(req.body?.action, 40)
      const taskId = text(req.body?.taskId, 220)
      const note = text(req.body?.note, 3000)
      if (action !== 'submit' || !taskId) {
        res.status(400).json({ error: 'Choose a task to submit.' })
        return
      }
      const loaded = await loadPortalLink(rawToken)
      const taskRef = loaded.eventRef.collection('tasks').doc(taskId)
      const activityRef = loaded.eventRef.collection('clientActivity').doc()
      const now = admin.firestore.FieldValue.serverTimestamp()

      await defaultDb.runTransaction(async transaction => {
        const [linkSnapshot, eventSnapshot, taskSnapshot] = await Promise.all([
          transaction.get(loaded.linkRef),
          transaction.get(loaded.eventRef),
          transaction.get(taskRef),
        ])
        if (!linkSnapshot.exists || !eventSnapshot.exists || !taskSnapshot.exists) throw new Error('INVALID_LINK')
        const link = linkSnapshot.data() as unknown as ClientPortalLink
        if (link.status !== 'active' || link.expiresAt.toMillis() < Date.now()) throw new Error('LINK_EXPIRED')
        const eventData = eventSnapshot.data() as RecordMap
        const livePortal = record(eventData.clientPortal)
        if (text(livePortal.publicLinkHash, 100) !== linkSnapshot.id || text(livePortal.status, 40) !== 'active') throw new Error('LINK_REVOKED')
        const taskData = taskSnapshot.data() as RecordMap
        if (taskData.clientVisible !== true) throw new Error('TASK_NOT_SHARED')
        if (text(taskData.status, 40) === 'done' || taskState(taskData.clientState) === 'verified') throw new Error('TASK_ALREADY_DONE')
        const taskTitle = text(taskData.title, 240) || 'Event task'
        transaction.update(taskRef, {
          status: text(taskData.status, 40) === 'todo' ? 'in_progress' : text(taskData.status, 40) || 'in_progress',
          clientState: 'submitted',
          clientSubmissionNote: note,
          clientSubmittedAt: now,
          clientStaffNote: '',
          updatedAt: now,
        })
        transaction.set(activityRef, {
          type: 'client_submitted',
          taskId,
          taskTitle,
          note,
          actor: link.recipientName || link.recipientEmail || 'Client',
          at: now,
          public: true,
        })
        transaction.update(loaded.eventRef, { updatedAt: now })
      })

      res.json({ ok: true })
      return
    }

    if (String(req.query.json || '') === '1') {
      res.json(await portalData(rawToken))
      return
    }

    await loadPortalLink(rawToken)
    res.status(200).type('html').send(portalHtml())
  } catch (error) {
    const message = errorMessage(error)
    if (String(req.query.json || '') === '1' || req.method === 'POST') {
      res.status(410).json({ error: message })
      return
    }
    res.status(410).type('html').send(`<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f7faf8;padding:40px"><div style="max-width:620px;margin:auto;background:#fff;border:1px solid #dfe8e2;border-radius:18px;padding:28px"><h1>Client portal unavailable</h1><p>${escapeHtml(message)}</p></div></body></html>`)
  }
})
