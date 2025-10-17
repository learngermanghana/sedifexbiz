const clone = value => (value === undefined ? value : JSON.parse(JSON.stringify(value)))

class MockTimestamp {
  constructor(millis = Date.now()) {
    this._millis = millis
  }

  static now() {
    return new MockTimestamp(Date.now())
  }

  static fromMillis(millis) {
    return new MockTimestamp(millis)
  }

  toMillis() {
    return this._millis
  }
}

class MockDocSnapshot {
  constructor(ref, data) {
    this._ref = ref
    this._data = data
  }

  get exists() {
    return this._data !== undefined
  }

  get id() {
    return this._ref.id
  }

  get ref() {
    return this._ref
  }

  data() {
    return this._data ? clone(this._data) : undefined
  }

  get(field) {
    return this._data ? this._data[field] : undefined
  }
}

class MockDocumentReference {
  constructor(db, path) {
    this._db = db
    this.path = path
  }

  get id() {
    const parts = this.path.split('/')
    return parts[parts.length - 1]
  }

  collection(name) {
    return new MockCollectionReference(this._db, `${this.path}/${name}`)
  }

  async get() {
    const data = this._db.getRaw(this.path)
    return new MockDocSnapshot(this, data ? clone(data) : undefined)
  }

  async set(data, options = {}) {
    const existing = this._db.getRaw(this.path)
    if (options && options.merge && existing) {
      this._db.setRaw(this.path, { ...existing, ...clone(data) })
    } else {
      this._db.setRaw(this.path, clone(data))
    }
  }
}

class MockQuery {
  constructor(db, path, filters = [], limitValue = null) {
    this._db = db
    this._path = path
    this._filters = filters
    this._limit = limitValue
  }

  where(field, op, value) {
    if (op !== '==') {
      throw new Error(`Unsupported operator: ${op}`)
    }
    return new MockQuery(this._db, this._path, [...this._filters, { field, value }], this._limit)
  }

  limit(count) {
    return new MockQuery(this._db, this._path, [...this._filters], count)
  }

  async get() {
    const candidates = this._db.listCollection(this._path)
    const matches = candidates.filter(({ data }) =>
      this._filters.every(filter => {
        const value = data ? data[filter.field] : undefined
        return value === filter.value
      }),
    )

    const limited = typeof this._limit === 'number' ? matches.slice(0, this._limit) : matches

    const docs = limited.map(
      ({ id, data }) => new MockQueryDocumentSnapshot(new MockDocumentReference(this._db, `${this._path}/${id}`), data),
    )

    return {
      empty: docs.length === 0,
      docs,
    }
  }
}

class MockCollectionReference extends MockQuery {
  constructor(db, path) {
    super(db, path)
  }

  doc(id) {
    const docId = id || this._db.generateId()
    return new MockDocumentReference(this._db, `${this._path}/${docId}`)
  }
}

class MockQueryDocumentSnapshot extends MockDocSnapshot {
  constructor(ref, data) {
    super(ref, data)
  }
}

class MockTransaction {
  constructor(db) {
    this._db = db
    this._writes = new Map()
  }

  async get(ref) {
    const pending = this._writes.get(ref.path)
    const base = pending || this._db.getRaw(ref.path)
    return new MockDocSnapshot(ref, base ? clone(base) : undefined)
  }

  set(ref, data) {
    this._writes.set(ref.path, clone(data))
  }

  update(ref, data) {
    const existing = this._writes.get(ref.path) || this._db.getRaw(ref.path)
    if (!existing) {
      throw new Error('Document does not exist')
    }
    this._writes.set(ref.path, { ...clone(existing), ...clone(data) })
  }

  commit() {
    for (const [path, value] of this._writes.entries()) {
      this._db.setRaw(path, value)
    }
  }
}

class MockFirestore {
  constructor(initialData = {}) {
    this._store = new Map()
    this._idCounter = 0
    for (const [path, value] of Object.entries(initialData)) {
      this.setRaw(path, value)
    }
  }

  collection(path) {
    return new MockCollectionReference(this, path)
  }

  generateId() {
    this._idCounter += 1
    return `mock-id-${this._idCounter}`
  }

  async runTransaction(fn) {
    const tx = new MockTransaction(this)
    const result = await fn(tx)
    tx.commit()
    return result
  }

  getRaw(path) {
    const value = this._store.get(path)
    return value ? clone(value) : undefined
  }

  setRaw(path, data) {
    this._store.set(path, clone(data))
  }

  getDoc(path) {
    return this.getRaw(path)
  }

  listCollection(path) {
    const prefix = `${path}/`
    const results = []
    for (const [docPath, value] of this._store.entries()) {
      if (docPath.startsWith(prefix)) {
        const remainder = docPath.slice(prefix.length)
        if (!remainder.includes('/')) {
          results.push({ id: remainder, data: clone(value) })
        }
      }
    }
    return results
  }
}

module.exports = {
  MockFirestore,
  MockTimestamp,
}
