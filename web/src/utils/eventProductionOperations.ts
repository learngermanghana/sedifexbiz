import { getEventProductionTemplate, type ProductionField } from './eventProductionTemplates'

export type ProductionPresetItem = {
  phase: string
  offsetMinutes: number
  activity: string
  remarks?: string
}

export type ProductionTimelineLike = {
  time: string
  coordinator?: string
  contactNumber?: string
  progressStatus?: string
}

export type ProductionReadinessInput = {
  eventDate: string
  startTime: string
  venue: string
  guestCount: number
  fields: ProductionField[]
  setup: Record<string, string>
  timeline: ProductionTimelineLike[]
  suggestedTimelineLength: number
}

export type ProductionReadiness = {
  score: number
  missing: string[]
}

const PRESETS: Record<string, ProductionPresetItem[]> = {
  'Traditional wedding': [
    { phase: 'Preparation', offsetMinutes: -240, activity: 'Bride and bride-family preparation begins' },
    { phase: 'Preparation', offsetMinutes: -180, activity: 'Groom and groom-family preparation begins' },
    { phase: 'Setup', offsetMinutes: -120, activity: 'Decor, seating, sound and presentation items final check' },
    { phase: 'Arrival', offsetMinutes: -45, activity: 'Family representatives and key guests arrive' },
    { phase: 'Ceremony', offsetMinutes: 0, activity: 'Traditional ceremony begins' },
    { phase: 'Photos', offsetMinutes: 90, activity: 'Family and couple photography' },
    { phase: 'Reception', offsetMinutes: 150, activity: 'Reception / celebration begins' },
  ],
  'White wedding': [
    { phase: 'Preparation', offsetMinutes: -240, activity: 'Bride preparation begins' },
    { phase: 'Preparation', offsetMinutes: -180, activity: 'Groom preparation begins' },
    { phase: 'Setup', offsetMinutes: -120, activity: 'Ceremony and reception production final check' },
    { phase: 'Arrival', offsetMinutes: -45, activity: 'Ushers, bridal party and key guests in position' },
    { phase: 'Ceremony', offsetMinutes: 0, activity: 'Wedding ceremony begins' },
    { phase: 'Transition', offsetMinutes: 90, activity: 'Photography and guest transition to reception' },
    { phase: 'Reception', offsetMinutes: 150, activity: 'Reception programme begins' },
  ],
  Engagement: [
    { phase: 'Setup', offsetMinutes: -150, activity: 'Presentation items, seating and sound final setup' },
    { phase: 'Family arrival', offsetMinutes: -60, activity: 'Both families and representatives arrive' },
    { phase: 'Presentation', offsetMinutes: 0, activity: 'Engagement presentation and family introductions begin' },
    { phase: 'Rites', offsetMinutes: 45, activity: 'Engagement rites and key announcements' },
    { phase: 'Photos', offsetMinutes: 90, activity: 'Couple and family photography' },
    { phase: 'Reception', offsetMinutes: 120, activity: 'Food, music and celebration begin' },
  ],
  Birthday: [
    { phase: 'Setup', offsetMinutes: -150, activity: 'Decor, cake, sound and guest area final setup' },
    { phase: 'Vendor check', offsetMinutes: -90, activity: 'Catering, DJ / MC and photographer check-in' },
    { phase: 'Guest arrival', offsetMinutes: -30, activity: 'Guest arrival and welcome begins' },
    { phase: 'Entrance', offsetMinutes: 0, activity: 'Celebrant entrance / opening moment' },
    { phase: 'Programme', offsetMinutes: 45, activity: 'Games, speeches or entertainment' },
    { phase: 'Cake', offsetMinutes: 90, activity: 'Cake cutting and photography' },
    { phase: 'Party', offsetMinutes: 120, activity: 'Open dance floor / party continues' },
  ],
  Funeral: [
    { phase: 'Setup', offsetMinutes: -180, activity: 'Seating, tents, sound, tribute and donation areas final setup' },
    { phase: 'Family arrival', offsetMinutes: -90, activity: 'Immediate family and protocol team arrive' },
    { phase: 'Guest arrival', offsetMinutes: -45, activity: 'Guest seating and reception begins' },
    { phase: 'Service', offsetMinutes: 0, activity: 'Funeral / memorial service begins' },
    { phase: 'Burial', offsetMinutes: 120, activity: 'Movement to burial / cemetery' },
    { phase: 'Reception', offsetMinutes: 210, activity: 'Post-service reception and donations continue' },
    { phase: 'Close', offsetMinutes: 330, activity: 'Donation reconciliation and production close-out' },
  ],
  'Naming ceremony': [
    { phase: 'Setup', offsetMinutes: -120, activity: 'Family seating, naming area and refreshments final setup' },
    { phase: 'Family arrival', offsetMinutes: -45, activity: 'Family representatives and elders arrive' },
    { phase: 'Naming', offsetMinutes: 0, activity: 'Naming ceremony / outdooring begins' },
    { phase: 'Blessings', offsetMinutes: 35, activity: 'Blessings, family remarks and introductions' },
    { phase: 'Photos', offsetMinutes: 60, activity: 'Baby and family photography' },
    { phase: 'Refreshments', offsetMinutes: 90, activity: 'Refreshments / celebration begins' },
  ],
  'Baby shower': [
    { phase: 'Setup', offsetMinutes: -120, activity: 'Decor, games, gifts, cake and seating final setup' },
    { phase: 'Guest arrival', offsetMinutes: -30, activity: 'Guest welcome and gift collection begins' },
    { phase: 'Welcome', offsetMinutes: 0, activity: 'Honouree entrance and welcome' },
    { phase: 'Games', offsetMinutes: 30, activity: 'Games and interactive activities' },
    { phase: 'Gifts', offsetMinutes: 75, activity: 'Gift presentation / opening' },
    { phase: 'Cake', offsetMinutes: 105, activity: 'Cake, photos and refreshments' },
  ],
  Anniversary: [
    { phase: 'Setup', offsetMinutes: -120, activity: 'Decor, cake, photo area and seating final setup' },
    { phase: 'Guest arrival', offsetMinutes: -30, activity: 'Guest welcome begins' },
    { phase: 'Entrance', offsetMinutes: 0, activity: 'Honouree / couple entrance' },
    { phase: 'Programme', offsetMinutes: 35, activity: 'Speeches, tributes and anniversary programme' },
    { phase: 'Cake', offsetMinutes: 75, activity: 'Cake cutting and photography' },
    { phase: 'Celebration', offsetMinutes: 105, activity: 'Food, music and dancing' },
  ],
  Graduation: [
    { phase: 'Setup', offsetMinutes: -120, activity: 'Stage, photo area, seating and catering final setup' },
    { phase: 'Graduate prep', offsetMinutes: -60, activity: 'Graduate preparation and family coordination' },
    { phase: 'Guest arrival', offsetMinutes: -30, activity: 'Guest seating and welcome begins' },
    { phase: 'Entrance', offsetMinutes: 0, activity: 'Graduate entrance / opening moment' },
    { phase: 'Programme', offsetMinutes: 35, activity: 'Speeches, acknowledgements and presentations' },
    { phase: 'Photos', offsetMinutes: 75, activity: 'Graduate and family photography' },
    { phase: 'Reception', offsetMinutes: 105, activity: 'Food / reception and entertainment' },
  ],
  'Corporate event': [
    { phase: 'Load-in', offsetMinutes: -240, activity: 'Production, stage, branding and AV load-in' },
    { phase: 'Technical', offsetMinutes: -150, activity: 'Sound, screens, presentations and livestream test' },
    { phase: 'Registration', offsetMinutes: -60, activity: 'Registration / accreditation desk opens' },
    { phase: 'Opening', offsetMinutes: 0, activity: 'Opening session begins' },
    { phase: 'Sessions', offsetMinutes: 60, activity: 'Main sessions / presentations continue' },
    { phase: 'Networking', offsetMinutes: 180, activity: 'Networking / refreshments / exhibition period' },
    { phase: 'Close', offsetMinutes: 300, activity: 'Closing session and production strike coordination' },
  ],
  'Conference / seminar': [
    { phase: 'Load-in', offsetMinutes: -210, activity: 'Venue, AV and registration setup' },
    { phase: 'Technical', offsetMinutes: -120, activity: 'Speaker presentations and microphone checks' },
    { phase: 'Registration', offsetMinutes: -60, activity: 'Delegate registration opens' },
    { phase: 'Opening', offsetMinutes: 0, activity: 'Welcome and opening session' },
    { phase: 'Sessions', offsetMinutes: 60, activity: 'Presentations / panels / workshops' },
    { phase: 'Breakout', offsetMinutes: 180, activity: 'Breakout or networking sessions' },
    { phase: 'Close', offsetMinutes: 300, activity: 'Closing remarks and delegate departure' },
  ],
  'Church / religious event': [
    { phase: 'Setup', offsetMinutes: -150, activity: 'Stage, choir, media and congregation seating setup' },
    { phase: 'Soundcheck', offsetMinutes: -90, activity: 'Choir, microphones and livestream soundcheck' },
    { phase: 'Arrival', offsetMinutes: -30, activity: 'Ministers, protocol team and congregation arrival' },
    { phase: 'Opening', offsetMinutes: 0, activity: 'Opening prayer / worship begins' },
    { phase: 'Programme', offsetMinutes: 45, activity: 'Ministration / sermon / special programme' },
    { phase: 'Close', offsetMinutes: 150, activity: 'Closing prayer, announcements and guest exit' },
  ],
  'School / educational event': [
    { phase: 'Setup', offsetMinutes: -150, activity: 'Stage, awards, seating and registration setup' },
    { phase: 'Participants', offsetMinutes: -60, activity: 'Students / participants assemble' },
    { phase: 'Guest arrival', offsetMinutes: -30, activity: 'Parents, guests and dignitaries arrive' },
    { phase: 'Opening', offsetMinutes: 0, activity: 'Opening / school programme begins' },
    { phase: 'Awards', offsetMinutes: 75, activity: 'Awards, certificates or presentations' },
    { phase: 'Photos', offsetMinutes: 120, activity: 'Group photography and guest interaction' },
    { phase: 'Close', offsetMinutes: 165, activity: 'Closing remarks and controlled departure' },
  ],
  'Concert / entertainment': [
    { phase: 'Load-in', offsetMinutes: -360, activity: 'Stage, sound, lighting and barricade load-in' },
    { phase: 'Soundcheck', offsetMinutes: -210, activity: 'Artist soundcheck and technical rehearsal' },
    { phase: 'Security', offsetMinutes: -90, activity: 'Security posts, ticketing and crowd-control final check' },
    { phase: 'Doors', offsetMinutes: -45, activity: 'Doors / ticket scanning opens' },
    { phase: 'Show', offsetMinutes: 0, activity: 'Opening act / show begins' },
    { phase: 'Headline', offsetMinutes: 120, activity: 'Headline / main entertainment segment' },
    { phase: 'Close', offsetMinutes: 240, activity: 'Show close, audience exit and production strike' },
  ],
  'Party / social event': [
    { phase: 'Setup', offsetMinutes: -150, activity: 'Decor, food, drinks, sound and seating final setup' },
    { phase: 'Vendor check', offsetMinutes: -90, activity: 'DJ / MC, catering and service team check-in' },
    { phase: 'Guest arrival', offsetMinutes: -30, activity: 'Guest welcome begins' },
    { phase: 'Opening', offsetMinutes: 0, activity: 'Host / special entrance and opening moment' },
    { phase: 'Food', offsetMinutes: 60, activity: 'Food / drinks service begins' },
    { phase: 'Entertainment', offsetMinutes: 105, activity: 'Music, games or special entertainment' },
    { phase: 'Close', offsetMinutes: 240, activity: 'Final announcements and guest departure' },
  ],
  'Charity / community': [
    { phase: 'Setup', offsetMinutes: -150, activity: 'Registration, donation and activity areas final setup' },
    { phase: 'Volunteer briefing', offsetMinutes: -75, activity: 'Volunteer / field-team briefing' },
    { phase: 'Registration', offsetMinutes: -30, activity: 'Participant / beneficiary registration opens' },
    { phase: 'Programme', offsetMinutes: 0, activity: 'Main community programme begins' },
    { phase: 'Donations', offsetMinutes: 60, activity: 'Donation / fundraising segment' },
    { phase: 'Distribution', offsetMinutes: 120, activity: 'Distribution / beneficiary service activity' },
    { phase: 'Close', offsetMinutes: 210, activity: 'Reconciliation, acknowledgements and close-out' },
  ],
  Other: [
    { phase: 'Setup', offsetMinutes: -120, activity: 'Venue and production setup' },
    { phase: 'Team briefing', offsetMinutes: -60, activity: 'Staff / vendor briefing and readiness check' },
    { phase: 'Arrival', offsetMinutes: -30, activity: 'Guest / participant arrival begins' },
    { phase: 'Opening', offsetMinutes: 0, activity: 'Main event activity begins' },
    { phase: 'Transition', offsetMinutes: 90, activity: 'Main programme transition / secondary activity' },
    { phase: 'Close', offsetMinutes: 180, activity: 'Event close and production wrap-up' },
  ],
}

export function getProductionTimelinePreset(eventType: string): ProductionPresetItem[] {
  const template = getEventProductionTemplate(eventType)
  return PRESETS[template.eventType] || PRESETS.Other
}

export function clockFromOffset(startTime: string, offsetMinutes: number) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(startTime)
  if (!match) return ''
  const start = Number(match[1]) * 60 + Number(match[2])
  const total = ((start + offsetMinutes) % 1440 + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export function calculateProductionReadiness(input: ProductionReadinessInput): ProductionReadiness {
  const basicChecks = [Boolean(input.eventDate), Boolean(input.startTime), Boolean(input.venue), input.guestCount > 0]
  const basicScore = (basicChecks.filter(Boolean).length / basicChecks.length) * 20

  const fieldCount = Math.max(1, input.fields.length)
  const completedFields = input.fields.filter(field => Boolean((input.setup[field.key] || '').trim())).length
  const setupScore = (completedFields / fieldCount) * 50

  const expectedTimeline = Math.max(1, Math.min(input.suggestedTimelineLength || 5, 7))
  const timelineScore = Math.min(input.timeline.length / expectedTimeline, 1) * 20

  const assignedRows = input.timeline.filter(row => Boolean((row.coordinator || '').trim()) || Boolean((row.contactNumber || '').trim())).length
  const ownershipScore = input.timeline.length ? (assignedRows / input.timeline.length) * 10 : 0

  const missing: string[] = []
  if (!input.eventDate || !input.startTime || !input.venue || input.guestCount <= 0) missing.push('Complete the event date, time, venue and expected guests.')
  const missingFields = input.fields.filter(field => !(input.setup[field.key] || '').trim()).slice(0, 3)
  if (missingFields.length) missing.push(`Complete production details: ${missingFields.map(field => field.label).join(', ')}.`)
  if (!input.timeline.length) missing.push('Add the event-day production timeline.')
  else if (input.timeline.length < expectedTimeline) missing.push(`Add more run-sheet detail (${input.timeline.length}/${expectedTimeline} suggested items).`)
  if (input.timeline.length && assignedRows < input.timeline.length) missing.push('Assign coordinators or contacts to remaining timeline items.')

  return { score: Math.max(0, Math.min(100, Math.round(basicScore + setupScore + timelineScore + ownershipScore))), missing }
}

export function nextProductionItem<T extends ProductionTimelineLike>(rows: T[], now = new Date()): T | null {
  if (!rows.length) return null
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const withMinutes = rows
    .map(row => {
      const match = /^(\d{1,2}):(\d{2})$/.exec(row.time)
      return { row, minutes: match ? Number(match[1]) * 60 + Number(match[2]) : Number.POSITIVE_INFINITY }
    })
    .sort((a, b) => a.minutes - b.minutes)
  return (withMinutes.find(item => item.minutes >= currentMinutes) || withMinutes[withMinutes.length - 1])?.row || null
}
