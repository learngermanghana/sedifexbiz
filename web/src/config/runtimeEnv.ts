type RuntimeEnvValue = string | boolean | undefined

type RuntimeEnvRecord = Record<string, RuntimeEnvValue>

function getImportMetaEnv(): RuntimeEnvRecord {
  if (typeof import.meta !== 'undefined' && import.meta?.env) {
    return import.meta.env as unknown as RuntimeEnvRecord
  }

  return {}
}

function getNodeProcessEnv(): RuntimeEnvRecord | undefined {
  if (typeof globalThis === 'undefined') {
    return undefined
  }

  const processCandidate = (globalThis as { process?: unknown }).process
  if (!processCandidate || typeof processCandidate !== 'object') {
    return undefined
  }

  const env = (processCandidate as { env?: unknown }).env
  if (!env || typeof env !== 'object') {
    return undefined
  }

  return env as RuntimeEnvRecord
}

function loadRuntimeEnv(): RuntimeEnvRecord {
  const importMetaEnv = getImportMetaEnv()
  const processEnv = getNodeProcessEnv()

  if (processEnv) {
    return { ...processEnv, ...importMetaEnv }
  }

  return importMetaEnv
}

export const runtimeEnv: RuntimeEnvRecord = loadRuntimeEnv()

export type { RuntimeEnvRecord }

export default runtimeEnv
