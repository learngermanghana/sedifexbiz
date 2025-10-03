const Module = require('module')

function createAdminStub() {
  const users = new Map()

  return {
    initializeApp: () => ({}),
    apps: [{}],
    auth: () => ({
      async getUser(uid) {
        if (!users.has(uid)) {
          const error = new Error('User not found')
          error.code = 'auth/user-not-found'
          throw error
        }
        return users.get(uid)
      },
      async getUserByEmail(email) {
        for (const user of users.values()) {
          if (user.email === email) return user
        }
        const error = new Error('User not found')
        error.code = 'auth/user-not-found'
        throw error
      },
      async createUser(payload) {
        const uid = `uid-${users.size + 1}`
        const record = { uid, email: payload.email ?? null, customClaims: undefined }
        users.set(uid, record)
        return record
      },
      async updateUser(uid, updates) {
        const existing = users.get(uid)
        if (!existing) {
          const error = new Error('User not found')
          error.code = 'auth/user-not-found'
          throw error
        }
        users.set(uid, { ...existing, ...updates })
        return users.get(uid)
      },
      async setCustomUserClaims(uid, claims) {
        const existing = users.get(uid) ?? { uid, email: null }
        users.set(uid, { ...existing, customClaims: claims })
        return undefined
      },
    }),
  }
}

function installFirebaseAdminStub() {
  const originalLoad = Module._load
  const adminStub = createAdminStub()

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'firebase-admin') {
      return adminStub
    }
    return originalLoad(request, parent, isMain)
  }

  return () => {
    Module._load = originalLoad
  }
}

module.exports = { installFirebaseAdminStub }
