const clone = value => (value === undefined ? value : JSON.parse(JSON.stringify(value)))

const isPlainObject = value => value && typeof value === 'object' && !Array.isArray(value)

const isMockIncrement = value => isPlainObject(value) && value.__mockIncrement !== undefined

const isMockDelete = value => isPlainObject(value) && value.__mockDelete === true

const resolveUpdateValue = (currentValue, incomingValue) => {
  if (isMockIncrement(incomingValue)) {
    const incrementBy = Number(incomingValue.__mockIncrement)
    const baseValue = Number.isFinite(Number(currentValue)) ? Number(currentValue) : 0
    return baseValue + incrementBy
  }
  return clone(incomingValue)
}

const applyFieldUpdate = (target, pathSegments, value) => {
  if (pathSegments.length === 0) {
    return target
  }

  const [head, ...rest] = pathSegments
  const result = { ...target }

  if (rest.length === 0) {
    if (isMockDelete(value)) {
      delete result[head]
      return result
    }

    if (isPlainObject(value) && !isMockIncrement(value)) {
      const current = isPlainObject(result[head]) ? result[head] : {}
      result[head] = applyMerge(current, value)
      return result
    }

    result[head] = resolveUpdateValue(result[head], value)
    return result
  }

  const current = isPlainObject(result[head]) ? result[head] : {}
  result[head] = applyFieldUpdate(current, rest, value)
  if (isMockDelete(value) && Object.keys(result[head]).length === 0) {
    delete result[head]
  }
  return result
}

const applyMerge = (existing = {}, updates = {}) => {
  let result = { ...clone(existing) }
  for (const [key, value] of Object.entries(updates || {})) {
    const segments = key.split('.')
    result = applyFieldUpdate(result, segments, value)
  }
  return result
}

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
  constructor(data) {
    this._data = data
  }

  get exists() {
    return this._data !== undefined
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
    return new MockDocSnapshot(data ? clone(data) : undefined)
  }

  async set(data, options = {}) {
    const existing = this._db.getRaw(this.path)
    if (options && options.merge) {
      this._db.setRaw(this.path, applyMerge(existing || {}, data))
    } else {
      this._db.setRaw(this.path, applyMerge({}, data))
    }
  }
}

class MockCollectionReference {
  constructor(db, path) {
    this._db = db
    this._path = path
  }

  doc(id) {
    const docId = id || this._db.generateId()
    return new MockDocumentReference(this._db, `${this._path}/${docId}`)
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
    return new MockDocSnapshot(base ? clone(base) : undefined)
  }

  set(ref, data, options = {}) {
    const existing = this._writes.get(ref.path) || this._db.getRaw(ref.path)
    if (options && options.merge) {
      this._writes.set(ref.path, applyMerge(existing || {}, data))
    } else {
      this._writes.set(ref.path, applyMerge({}, data))
    }
  }

  update(ref, data) {
    const existing = this._writes.get(ref.path) || this._db.getRaw(ref.path)
    if (!existing) {
      throw new Error('Document does not exist')
    }
    this._writes.set(ref.path, applyMerge(existing, data))
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
