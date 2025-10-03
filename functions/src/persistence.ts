export type Role = 'owner' | 'staff'

export interface TeamMemberRecord {
  uid: string
  storeId: string
  role: Role
  email?: string | null
  phone?: string | null
  firstSignupEmail?: string | null
  company?: string | null
  name?: string | null
  country?: string | null
  city?: string | null
  invitedBy?: string | null
  createdAt: Date
  updatedAt: Date
}

export interface StoreRecord {
  id: string
  name: string
  displayName: string
  timezone: string
  currency: string
  company?: string | null
  ownerName?: string | null
  country?: string | null
  city?: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CallableErrorLogEntry {
  route: string
  storeId: string | null
  authUid: string | null
  payloadShape: unknown
  error: unknown
  createdAt: Date
}

export interface PersistenceAdapter {
  getTeamMember(uid: string): Promise<TeamMemberRecord | null>
  upsertTeamMember(record: Partial<TeamMemberRecord> & { uid: string }): Promise<TeamMemberRecord>
  removeTeamMember(uid: string): Promise<void>
  getStore(storeId: string): Promise<StoreRecord | null>
  upsertStore(record: Partial<StoreRecord> & { id: string }): Promise<StoreRecord>
  listTeamMembers(storeId: string): Promise<TeamMemberRecord[]>
  recordCallableError(entry: CallableErrorLogEntry): Promise<void>
}

class MemoryPersistence implements PersistenceAdapter {
  private teamMembers = new Map<string, TeamMemberRecord>()
  private stores = new Map<string, StoreRecord>()
  private logs: CallableErrorLogEntry[] = []

  async getTeamMember(uid: string): Promise<TeamMemberRecord | null> {
    const record = this.teamMembers.get(uid)
    return record ? { ...record } : null
  }

  async upsertTeamMember(record: Partial<TeamMemberRecord> & { uid: string }) {
    const existing = this.teamMembers.get(record.uid)
    const now = new Date()
    const merged: TeamMemberRecord = {
      uid: record.uid,
      storeId: record.storeId ?? existing?.storeId ?? '',
      role: (record.role ?? existing?.role ?? 'staff') as Role,
      email: record.email ?? existing?.email ?? null,
      phone: record.phone ?? existing?.phone ?? null,
      firstSignupEmail: record.firstSignupEmail ?? existing?.firstSignupEmail ?? null,
      company: record.company ?? existing?.company ?? null,
      name: record.name ?? existing?.name ?? null,
      country: record.country ?? existing?.country ?? null,
      city: record.city ?? existing?.city ?? null,
      invitedBy: record.invitedBy ?? existing?.invitedBy ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }

    if (!merged.storeId) {
      throw new Error('storeId is required when creating a team member')
    }

    this.teamMembers.set(record.uid, merged)
    return { ...merged }
  }

  async removeTeamMember(uid: string): Promise<void> {
    this.teamMembers.delete(uid)
  }

  async getStore(storeId: string): Promise<StoreRecord | null> {
    const record = this.stores.get(storeId)
    return record ? { ...record } : null
  }

  async upsertStore(record: Partial<StoreRecord> & { id: string }): Promise<StoreRecord> {
    const existing = this.stores.get(record.id)
    const now = new Date()
    const merged: StoreRecord = {
      id: record.id,
      name: record.name ?? existing?.name ?? record.id,
      displayName: record.displayName ?? existing?.displayName ?? record.name ?? record.id,
      timezone: record.timezone ?? existing?.timezone ?? 'UTC',
      currency: record.currency ?? existing?.currency ?? 'USD',
      company: record.company ?? existing?.company ?? null,
      ownerName: record.ownerName ?? existing?.ownerName ?? null,
      country: record.country ?? existing?.country ?? null,
      city: record.city ?? existing?.city ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }

    this.stores.set(record.id, merged)
    return { ...merged }
  }

  async listTeamMembers(storeId: string): Promise<TeamMemberRecord[]> {
    return Array.from(this.teamMembers.values())
      .filter(member => member.storeId === storeId)
      .map(member => ({ ...member }))
  }

  async recordCallableError(entry: CallableErrorLogEntry): Promise<void> {
    this.logs.push({ ...entry })
  }

  getLogs(): CallableErrorLogEntry[] {
    return this.logs.map(entry => ({ ...entry }))
  }
}

class ApiPersistence implements PersistenceAdapter {
  constructor(private readonly baseUrl: string, private readonly apiKey: string | null) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = new URL(path, this.baseUrl)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`API request failed with status ${response.status}: ${text}`)
    }

    if (response.status === 204) {
      return undefined as T
    }

    const json = (await response.json()) as { data?: T; error?: unknown }
    if (json.error) {
      throw new Error(`API returned error: ${JSON.stringify(json.error)}`)
    }
    return json.data as T
  }

  async getTeamMember(uid: string): Promise<TeamMemberRecord | null> {
    const data = await this.request<TeamMemberRecord | null>('GET', `/team-members/${uid}`)
    return data ? this.normalizeTeamMember(data) : null
  }

  async upsertTeamMember(record: Partial<TeamMemberRecord> & { uid: string }): Promise<TeamMemberRecord> {
    const payload = await this.request<TeamMemberRecord>('PUT', `/team-members/${record.uid}`, record)
    return this.normalizeTeamMember(payload)
  }

  async removeTeamMember(uid: string): Promise<void> {
    await this.request<void>('DELETE', `/team-members/${uid}`)
  }

  async getStore(storeId: string): Promise<StoreRecord | null> {
    const data = await this.request<StoreRecord | null>('GET', `/stores/${storeId}`)
    return data ? this.normalizeStore(data) : null
  }

  async upsertStore(record: Partial<StoreRecord> & { id: string }): Promise<StoreRecord> {
    const data = await this.request<StoreRecord>('PUT', `/stores/${record.id}`, record)
    return this.normalizeStore(data)
  }

  async listTeamMembers(storeId: string): Promise<TeamMemberRecord[]> {
    const data = await this.request<TeamMemberRecord[]>(
      'GET',
      `/stores/${storeId}/team-members`,
    )
    return data.map(entry => this.normalizeTeamMember(entry))
  }

  async recordCallableError(entry: CallableErrorLogEntry): Promise<void> {
    await this.request('POST', '/callable-logs', entry)
  }

  private normalizeTeamMember(record: TeamMemberRecord): TeamMemberRecord {
    return {
      uid: record.uid,
      storeId: record.storeId,
      role: record.role,
      email: record.email ?? null,
      phone: record.phone ?? null,
      firstSignupEmail: record.firstSignupEmail ?? null,
      company: record.company ?? null,
      name: record.name ?? null,
      country: record.country ?? null,
      city: record.city ?? null,
      invitedBy: record.invitedBy ?? null,
      createdAt: record.createdAt ? new Date(record.createdAt) : new Date(),
      updatedAt: record.updatedAt ? new Date(record.updatedAt) : new Date(),
    }
  }

  private normalizeStore(record: StoreRecord): StoreRecord {
    return {
      id: record.id,
      name: record.name,
      displayName: record.displayName ?? record.name,
      timezone: record.timezone ?? 'UTC',
      currency: record.currency ?? 'USD',
      company: record.company ?? null,
      ownerName: record.ownerName ?? null,
      country: record.country ?? null,
      city: record.city ?? null,
      createdAt: record.createdAt ? new Date(record.createdAt) : new Date(),
      updatedAt: record.updatedAt ? new Date(record.updatedAt) : new Date(),
    }
  }
}

let adapter: PersistenceAdapter | null = null

export function getPersistence(): PersistenceAdapter {
  if (adapter) return adapter

  const driver = process.env.PERSISTENCE_DRIVER ?? 'api'
  if (driver === 'memory') {
    adapter = new MemoryPersistence()
    return adapter
  }

  const url = process.env.SEDIFEX_API_URL
  if (!url) {
    throw new Error('SEDIFEX_API_URL must be set for API persistence')
  }
  const apiKey = process.env.SEDIFEX_API_KEY ?? null
  adapter = new ApiPersistence(url, apiKey)
  return adapter
}

export function setPersistenceAdapter(instance: PersistenceAdapter | null) {
  adapter = instance
}

export function createMemoryPersistence(): MemoryPersistence {
  return new MemoryPersistence()
}
