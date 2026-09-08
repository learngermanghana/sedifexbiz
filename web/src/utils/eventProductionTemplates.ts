export type ProductionFieldType = 'text' | 'number' | 'select' | 'textarea'

export type ProductionField = {
  key: string
  label: string
  type?: ProductionFieldType
  placeholder?: string
  wide?: boolean
  options?: Array<{ value: string; label: string }>
}

export type EventProductionTemplate = {
  eventType: string
  title: string
  description: string
  phasePlaceholder: string
  fields: ProductionField[]
}

export const EVENT_TYPES = [
  'Traditional wedding',
  'White wedding',
  'Engagement',
  'Birthday',
  'Funeral',
  'Naming ceremony',
  'Baby shower',
  'Anniversary',
  'Graduation',
  'Corporate event',
  'Conference / seminar',
  'Church / religious event',
  'School / educational event',
  'Concert / entertainment',
  'Party / social event',
  'Charity / community',
  'Other',
]

const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
]

const common = {
  project: { key: 'projectLabel', label: 'Project / event', placeholder: 'Event or production name' } satisfies ProductionField,
  guests: { key: 'confirmedGuests', label: 'Confirmed guests', type: 'number' } satisfies ProductionField,
  theme: { key: 'eventTheme', label: 'Event theme', placeholder: 'Theme or concept' } satisfies ProductionField,
  colours: { key: 'eventColours', label: 'Event colours', placeholder: 'Main production colours' } satisfies ProductionField,
  invitation: { key: 'strictlyByInvitation', label: 'Strictly by invitation?', type: 'select', options: YES_NO } satisfies ProductionField,
  seating: { key: 'placedSeating', label: 'Assigned / placed seating?', type: 'select', options: YES_NO } satisfies ProductionField,
  tables: { key: 'reservedTables', label: 'Reserved / VIP tables', type: 'number' } satisfies ProductionField,
}

export const EVENT_PRODUCTION_TEMPLATES: Record<string, EventProductionTemplate> = {
  'Traditional wedding': {
    eventType: 'Traditional wedding',
    title: 'Traditional wedding production details',
    description: 'Plan the family, customary ceremony, guest setup, reception and movement between each production phase.',
    phasePlaceholder: 'Bride prep, groom prep, customary ceremony, reception…',
    fields: [
      common.project, common.guests, common.theme, common.colours, common.invitation, common.seating,
      { key: 'bridalPartySize', label: 'Bridal / family party size', type: 'number' }, common.tables,
      { key: 'ceremonySetupGuests', label: 'Guests setup for customary ceremony', type: 'number' },
      { key: 'receptionSetupGuests', label: 'Guests setup for reception', type: 'number' },
      { key: 'bridePrepLocation', label: 'Phase 1 · Bride / bride-family preparation location' },
      { key: 'groomPrepLocation', label: 'Phase 2 · Groom / groom-family preparation location' },
      { key: 'ceremonyLocation', label: 'Phase 3 · Traditional ceremony location' },
      { key: 'receptionLocation', label: 'Phase 4 · Reception / celebration location' },
    ],
  },
  'White wedding': {
    eventType: 'White wedding',
    title: 'White wedding production details',
    description: 'Plan bridal preparation, church or civil ceremony, reception, seating and the wedding production flow.',
    phasePlaceholder: 'Bride prep, groom prep, ceremony, reception…',
    fields: [
      common.project, common.guests, common.theme, common.colours, common.invitation, common.seating,
      { key: 'bridalPartySize', label: 'Bridal party size', type: 'number' }, common.tables,
      { key: 'ceremonySetupGuests', label: 'Guests setup for ceremony', type: 'number' },
      { key: 'receptionSetupGuests', label: 'Guests setup for reception', type: 'number' },
      { key: 'bridePrepLocation', label: 'Phase 1 · Bride dress-up location' },
      { key: 'groomPrepLocation', label: 'Phase 2 · Groom dress-up location' },
      { key: 'ceremonyLocation', label: 'Phase 3 · Ceremony / church location' },
      { key: 'receptionLocation', label: 'Phase 4 · Reception location' },
    ],
  },
  Engagement: {
    eventType: 'Engagement',
    title: 'Engagement production details',
    description: 'Plan both families, presentation items, customary engagement flow, seating and celebration areas.',
    phasePlaceholder: 'Family arrival, presentation, engagement rites, photos, reception…',
    fields: [
      common.project,
      { key: 'coupleNames', label: 'Couple names' },
      common.guests, common.theme, common.colours, common.invitation, common.seating,
      { key: 'bridalPartySize', label: 'Family / bridal party size', type: 'number' }, common.tables,
      { key: 'ceremonySetupGuests', label: 'Guests setup for engagement ceremony', type: 'number' },
      { key: 'receptionSetupGuests', label: 'Guests setup for reception / celebration', type: 'number' },
      { key: 'bridePrepLocation', label: 'Bride / bride-family preparation location' },
      { key: 'groomPrepLocation', label: 'Groom / groom-family holding location' },
      { key: 'ceremonyLocation', label: 'Engagement ceremony location' },
      { key: 'receptionLocation', label: 'Reception / celebration location' },
    ],
  },
  Birthday: {
    eventType: 'Birthday',
    title: 'Birthday production details',
    description: 'Plan the celebrant entrance, cake, entertainment, guest seating, photo moments and party zones.',
    phasePlaceholder: 'Setup, guest arrival, celebrant entrance, cake, entertainment…',
    fields: [
      common.project,
      { key: 'celebrantName', label: 'Celebrant name' },
      { key: 'ageMilestone', label: 'Age / milestone', placeholder: 'e.g. 30th, 50th, sweet 16' },
      common.guests, common.theme, common.colours, common.invitation, common.seating, common.tables,
      { key: 'celebrantPrepLocation', label: 'Celebrant preparation / holding area' },
      { key: 'mainPartyLocation', label: 'Main party / guest area' },
      { key: 'cakeTableLocation', label: 'Cake / presentation area' },
      { key: 'photoArea', label: 'Photo / backdrop area' },
      { key: 'danceFloorLocation', label: 'Dance floor / entertainment area' },
    ],
  },
  Funeral: {
    eventType: 'Funeral',
    title: 'Funeral production details',
    description: 'Coordinate the family, wake or viewing, funeral service, burial, donations and post-service reception.',
    phasePlaceholder: 'Wake, family arrival, service, burial, reception…',
    fields: [
      common.project,
      { key: 'deceasedName', label: 'Name of deceased' },
      { key: 'confirmedGuests', label: 'Expected attendance', type: 'number' },
      { key: 'eventTheme', label: 'Funeral theme / dress direction', placeholder: 'Theme, cloth or dress direction' },
      common.colours,
      { key: 'serviceType', label: 'Service type', placeholder: 'Church, graveside, memorial, private…' },
      common.seating, common.tables,
      { key: 'familySeatingCount', label: 'Reserved family seating', type: 'number' },
      { key: 'wakeLocation', label: 'Wake / viewing location' },
      { key: 'serviceLocation', label: 'Funeral / memorial service location' },
      { key: 'burialLocation', label: 'Burial / cemetery location' },
      { key: 'donationDeskLocation', label: 'Donation / tribute desk location' },
      { key: 'receptionLocation', label: 'Post-service reception location' },
    ],
  },
  'Naming ceremony': {
    eventType: 'Naming ceremony',
    title: 'Naming ceremony production details',
    description: 'Plan the family protocol, naming moment, guest setup, refreshments and celebration areas.',
    phasePlaceholder: 'Family arrival, naming rite, photos, refreshments…',
    fields: [
      common.project,
      { key: 'childName', label: 'Child / baby name' },
      common.guests, common.theme, common.colours, common.invitation, common.seating, common.tables,
      { key: 'familyRepresentatives', label: 'Family representatives / elders', type: 'number' },
      { key: 'ceremonySetupGuests', label: 'Guests setup for naming ceremony', type: 'number' },
      { key: 'familyHoldingArea', label: 'Family / baby preparation area' },
      { key: 'ceremonyLocation', label: 'Naming ceremony location' },
      { key: 'photoArea', label: 'Family photo area' },
      { key: 'receptionLocation', label: 'Refreshments / reception area' },
    ],
  },
  'Baby shower': {
    eventType: 'Baby shower',
    title: 'Baby shower production details',
    description: 'Plan the parent-to-be arrival, games, gifts, food, photo moments and guest seating.',
    phasePlaceholder: 'Setup, guest arrival, games, gifts, cake, photos…',
    fields: [
      common.project,
      { key: 'honoureeName', label: 'Parent / honouree name' },
      common.guests, common.theme, common.colours, common.invitation, common.seating, common.tables,
      { key: 'giftTableLocation', label: 'Gift table / gift collection area' },
      { key: 'gameArea', label: 'Games / activity area' },
      { key: 'cakeTableLocation', label: 'Cake / dessert area' },
      { key: 'photoArea', label: 'Photo / backdrop area' },
      { key: 'mainPartyLocation', label: 'Main guest / dining area' },
    ],
  },
  Anniversary: {
    eventType: 'Anniversary',
    title: 'Anniversary production details',
    description: 'Plan the honourees, guest seating, speeches, cake, photo moments, entertainment and celebration flow.',
    phasePlaceholder: 'Setup, guest arrival, honouree entrance, speeches, cake, entertainment…',
    fields: [
      common.project,
      { key: 'honoureeNames', label: 'Honouree / couple names' },
      { key: 'anniversaryMilestone', label: 'Anniversary milestone', placeholder: 'e.g. 10 years, silver jubilee, 25th' },
      common.guests, common.theme, common.colours, common.invitation, common.seating, common.tables,
      { key: 'honoureeHoldingArea', label: 'Honouree preparation / holding area' },
      { key: 'mainCelebrationLocation', label: 'Main celebration area' },
      { key: 'cakeTableLocation', label: 'Cake / presentation area' },
      { key: 'photoArea', label: 'Photo / backdrop area' },
      { key: 'danceFloorLocation', label: 'Dance floor / entertainment area' },
    ],
  },
  Graduation: {
    eventType: 'Graduation',
    title: 'Graduation production details',
    description: 'Plan the graduate, family and guest flow, stage moments, photography, food and after-party production.',
    phasePlaceholder: 'Graduate prep, guest arrival, entrance, speeches, photos, reception…',
    fields: [
      common.project,
      { key: 'graduateName', label: 'Graduate name' },
      { key: 'institutionName', label: 'School / institution' },
      { key: 'qualification', label: 'Programme / qualification' },
      common.guests, common.theme, common.colours, common.invitation, common.seating, common.tables,
      { key: 'stageSetupGuests', label: 'Guests setup for main celebration', type: 'number' },
      { key: 'graduatePrepLocation', label: 'Graduate preparation / holding area' },
      { key: 'mainCelebrationLocation', label: 'Main celebration / stage area' },
      { key: 'photoArea', label: 'Photography / family photo area' },
      { key: 'receptionLocation', label: 'Food / reception area' },
      { key: 'afterPartyLocation', label: 'After-party / entertainment area' },
    ],
  },
  'Corporate event': {
    eventType: 'Corporate event',
    title: 'Corporate event production details',
    description: 'Plan registration, speakers, stage and AV, branding, sponsors, breakout spaces and VIP movement.',
    phasePlaceholder: 'Load-in, registration, opening, sessions, networking, close…',
    fields: [
      common.project,
      { key: 'organisationName', label: 'Organisation / client' },
      { key: 'confirmedGuests', label: 'Expected delegates / attendees', type: 'number' },
      { key: 'eventTheme', label: 'Corporate event theme' },
      { key: 'eventColours', label: 'Brand / production colours' },
      { key: 'registrationExpected', label: 'Registration target', type: 'number' },
      { key: 'speakerCount', label: 'Speakers / panelists', type: 'number' },
      { key: 'sponsorCount', label: 'Sponsors / partners', type: 'number' },
      common.tables,
      { key: 'registrationDeskLocation', label: 'Registration / accreditation desk' },
      { key: 'mainStageLocation', label: 'Main stage / plenary location' },
      { key: 'breakoutRooms', label: 'Breakout rooms / session spaces' },
      { key: 'exhibitionArea', label: 'Exhibition / sponsor area' },
      { key: 'vipHoldingArea', label: 'VIP / speaker holding area' },
      { key: 'livestreamSetup', label: 'Livestream / broadcast setup', wide: true, type: 'textarea', placeholder: 'Streaming platform, camera positions, internet, recording requirements…' },
    ],
  },
  'Conference / seminar': {
    eventType: 'Conference / seminar',
    title: 'Conference / seminar production details',
    description: 'Coordinate registration, sessions, speakers, panels, breakout rooms, AV, networking and delegate movement.',
    phasePlaceholder: 'Load-in, registration, opening, sessions, breakouts, networking, close…',
    fields: [
      common.project,
      { key: 'organisationName', label: 'Host organisation' },
      { key: 'confirmedGuests', label: 'Expected delegates', type: 'number' },
      { key: 'speakerCount', label: 'Speakers / facilitators', type: 'number' },
      { key: 'sessionCount', label: 'Sessions / panels', type: 'number' },
      common.theme,
      { key: 'eventColours', label: 'Brand / production colours' },
      { key: 'registrationDeskLocation', label: 'Registration / accreditation desk' },
      { key: 'mainStageLocation', label: 'Main hall / plenary room' },
      { key: 'breakoutRooms', label: 'Breakout / workshop rooms' },
      { key: 'speakerHoldingArea', label: 'Speaker / facilitator holding area' },
      { key: 'networkingArea', label: 'Networking / refreshment area' },
      { key: 'avRequirements', label: 'AV / presentation requirements', type: 'textarea', wide: true, placeholder: 'Screens, microphones, projectors, interpretation, streaming, recording…' },
    ],
  },
  'Church / religious event': {
    eventType: 'Church / religious event',
    title: 'Church / religious event production details',
    description: 'Plan worship, ministry or ceremony flow, ministers, choir, congregation seating, media and protocol.',
    phasePlaceholder: 'Setup, prayer, worship, ministration, sermon, special activity, close…',
    fields: [
      common.project,
      { key: 'hostMinistry', label: 'Church / ministry / host' },
      { key: 'confirmedGuests', label: 'Expected congregation / guests', type: 'number' },
      { key: 'ministerCount', label: 'Ministers / speakers', type: 'number' },
      { key: 'choirTeamSize', label: 'Choir / music team size', type: 'number' },
      common.theme, common.colours, common.seating,
      { key: 'altarStageLocation', label: 'Altar / stage location' },
      { key: 'ministerHoldingArea', label: 'Minister / guest holding area' },
      { key: 'choirLocation', label: 'Choir / music team area' },
      { key: 'mediaDeskLocation', label: 'Media / livestream control area' },
      { key: 'overflowArea', label: 'Overflow / additional seating area' },
      { key: 'specialProtocol', label: 'Religious / protocol requirements', type: 'textarea', wide: true },
    ],
  },
  'School / educational event': {
    eventType: 'School / educational event',
    title: 'School / educational event production details',
    description: 'Plan students, parents, staff, stage activity, presentations, awards, registration and school protocol.',
    phasePlaceholder: 'Setup, registration, student assembly, programme, awards, photos, close…',
    fields: [
      common.project,
      { key: 'institutionName', label: 'School / institution' },
      { key: 'confirmedGuests', label: 'Expected attendees', type: 'number' },
      { key: 'studentCount', label: 'Students / participants', type: 'number' },
      { key: 'staffCount', label: 'Staff / teachers', type: 'number' },
      common.theme, common.colours, common.seating,
      { key: 'registrationDeskLocation', label: 'Registration / welcome desk' },
      { key: 'mainStageLocation', label: 'Main stage / assembly area' },
      { key: 'studentHoldingArea', label: 'Student / participant holding area' },
      { key: 'awardTableLocation', label: 'Awards / certificates table' },
      { key: 'photoArea', label: 'Photography / group photo area' },
      { key: 'schoolProtocol', label: 'School protocol / safety notes', type: 'textarea', wide: true },
    ],
  },
  'Concert / entertainment': {
    eventType: 'Concert / entertainment',
    title: 'Concert / entertainment production details',
    description: 'Coordinate stage, artists, sound, lighting, backstage, ticketing, security, audience zones and show flow.',
    phasePlaceholder: 'Load-in, soundcheck, doors open, opening act, headline, close…',
    fields: [
      common.project,
      { key: 'confirmedGuests', label: 'Expected audience', type: 'number' },
      { key: 'artistCount', label: 'Artists / acts', type: 'number' },
      { key: 'crewCount', label: 'Production crew', type: 'number' },
      { key: 'ticketingType', label: 'Ticketing / access type', placeholder: 'Free, ticketed, VIP, invite only…' },
      common.theme, common.colours,
      { key: 'mainStageLocation', label: 'Main stage location' },
      { key: 'backstageLocation', label: 'Backstage / artist holding area' },
      { key: 'fohLocation', label: 'Front-of-house sound / lighting position' },
      { key: 'vipArea', label: 'VIP / reserved audience area' },
      { key: 'entryGateLocation', label: 'Entry / ticket scan location' },
      { key: 'securityPosts', label: 'Security / crowd-control posts' },
      { key: 'technicalRequirements', label: 'Technical rider / production requirements', type: 'textarea', wide: true },
    ],
  },
  'Party / social event': {
    eventType: 'Party / social event',
    title: 'Party / social event production details',
    description: 'Plan guest arrival, seating, food, drinks, music, photo moments, special entrances and party flow.',
    phasePlaceholder: 'Setup, guest arrival, entrance, food, entertainment, special moment, close…',
    fields: [
      common.project, common.guests, common.theme, common.colours, common.invitation, common.seating, common.tables,
      { key: 'mainPartyLocation', label: 'Main party / guest area' },
      { key: 'foodServiceLocation', label: 'Food / buffet service area' },
      { key: 'barLocation', label: 'Drinks / bar area' },
      { key: 'photoArea', label: 'Photo / backdrop area' },
      { key: 'danceFloorLocation', label: 'Dance floor / entertainment area' },
      { key: 'vipArea', label: 'VIP / reserved area' },
    ],
  },
  'Charity / community': {
    eventType: 'Charity / community',
    title: 'Charity / community event production details',
    description: 'Coordinate beneficiaries, volunteers, donations, registration, stage activity, distribution and sponsor visibility.',
    phasePlaceholder: 'Setup, registration, programme, donations, distribution, close…',
    fields: [
      common.project,
      { key: 'confirmedGuests', label: 'Expected participants', type: 'number' },
      { key: 'beneficiaryCount', label: 'Expected beneficiaries', type: 'number' },
      { key: 'volunteerCount', label: 'Volunteers / field team', type: 'number' },
      { key: 'sponsorCount', label: 'Sponsors / partners', type: 'number' },
      { key: 'donationGoal', label: 'Donation / fundraising target', placeholder: 'Amount or target description' },
      common.theme, common.colours,
      { key: 'registrationDeskLocation', label: 'Registration / welcome desk' },
      { key: 'mainActivityLocation', label: 'Main activity / programme area' },
      { key: 'donationDeskLocation', label: 'Donation collection area' },
      { key: 'distributionArea', label: 'Distribution / beneficiary service area' },
      { key: 'stageLocation', label: 'Stage / announcement area' },
      { key: 'productionNotes', label: 'Community logistics / safety notes', wide: true, type: 'textarea' },
    ],
  },
  Other: {
    eventType: 'Other',
    title: 'General event production details',
    description: 'Use a flexible production setup for any event that does not match the standard Sedifex event categories.',
    phasePlaceholder: 'Setup, arrival, main activity, transition, close…',
    fields: [
      common.project,
      { key: 'eventTypeDescription', label: 'Event type / format', placeholder: 'Describe the event' },
      common.guests, common.theme, common.colours, common.invitation, common.seating, common.tables,
      { key: 'primaryLocation', label: 'Primary event / activity location' },
      { key: 'secondaryLocation', label: 'Secondary / transition location' },
      { key: 'vipHoldingArea', label: 'VIP / special guest area' },
      { key: 'productionNotes', label: 'Production requirements', type: 'textarea', wide: true, placeholder: 'Stage, AV, décor, access, logistics, safety or other setup requirements…' },
    ],
  },
}

export function getEventProductionTemplate(eventType: string): EventProductionTemplate {
  const raw = String(eventType || '').trim()
  if (EVENT_PRODUCTION_TEMPLATES[raw]) return EVENT_PRODUCTION_TEMPLATES[raw]

  const normalized = raw.toLowerCase()
  if (normalized.includes('traditional') && normalized.includes('wedding')) return EVENT_PRODUCTION_TEMPLATES['Traditional wedding']
  if ((normalized.includes('white') || normalized.includes('church') || normalized.includes('civil')) && normalized.includes('wedding')) return EVENT_PRODUCTION_TEMPLATES['White wedding']
  if (normalized === 'wedding') return EVENT_PRODUCTION_TEMPLATES['White wedding']
  if (normalized.includes('engagement')) return EVENT_PRODUCTION_TEMPLATES.Engagement
  if (normalized.includes('birthday')) return EVENT_PRODUCTION_TEMPLATES.Birthday
  if (normalized.includes('funeral') || normalized.includes('memorial')) return EVENT_PRODUCTION_TEMPLATES.Funeral
  if (normalized.includes('naming') || normalized.includes('christening') || normalized.includes('outdooring')) return EVENT_PRODUCTION_TEMPLATES['Naming ceremony']
  if (normalized.includes('baby shower')) return EVENT_PRODUCTION_TEMPLATES['Baby shower']
  if (normalized.includes('anniversary') || normalized.includes('jubilee')) return EVENT_PRODUCTION_TEMPLATES.Anniversary
  if (normalized.includes('graduation')) return EVENT_PRODUCTION_TEMPLATES.Graduation
  if (normalized.includes('seminar') || normalized.includes('workshop') || normalized.includes('conference')) return EVENT_PRODUCTION_TEMPLATES['Conference / seminar']
  if (normalized.includes('corporate') || normalized.includes('business event') || normalized.includes('product launch')) return EVENT_PRODUCTION_TEMPLATES['Corporate event']
  if (normalized.includes('church') || normalized.includes('religious') || normalized.includes('crusade') || normalized.includes('worship')) return EVENT_PRODUCTION_TEMPLATES['Church / religious event']
  if (normalized.includes('school') || normalized.includes('educational') || normalized.includes('academic')) return EVENT_PRODUCTION_TEMPLATES['School / educational event']
  if (normalized.includes('concert') || normalized.includes('festival') || normalized.includes('show') || normalized.includes('entertainment')) return EVENT_PRODUCTION_TEMPLATES['Concert / entertainment']
  if (normalized.includes('party') || normalized.includes('social event')) return EVENT_PRODUCTION_TEMPLATES['Party / social event']
  if (normalized.includes('charity') || normalized.includes('community') || normalized.includes('fundrais')) return EVENT_PRODUCTION_TEMPLATES['Charity / community']
  return EVENT_PRODUCTION_TEMPLATES.Other
}
