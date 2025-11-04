const requiredEnvKeys = [
  'VITE_FB_API_KEY',
  'VITE_FB_AUTH_DOMAIN',
  'VITE_FB_PROJECT_ID',
  'VITE_FB_STORAGE_BUCKET',
  'VITE_FB_APP_ID',
] as const

const appCheckSiteKeyEnvKeys = [
  'VITE_FB_APP_CHECK_SITE_KEY',
  'VITE_RECAPTCHA_SITE_KEY',
] as const

const appCheckDebugTokenEnvKeys = [
  'VITE_FB_APP_CHECK_DEBUG_TOKEN',
  'VITE_APPCHECK_DEBUG_TOKEN',
] as const

const defaultFirebaseEnv: Record<string, string | undefined> = {
  VITE_FB_API_KEY: 'AIzaSyDwqED5PminaTUDRAquyFMhSA6vroj1Ccw',
  VITE_FB_AUTH_DOMAIN: 'sedifex-ac2b0.firebaseapp.com',
  VITE_FB_PROJECT_ID: 'sedifex-ac2b0',
  VITE_FB_STORAGE_BUCKET: 'sedifex-ac2b0.appspot.com',
  VITE_FB_APP_ID: '1:519571382805:web:d0f4653d62a71dfa58a41c',
  VITE_FB_FUNCTIONS_REGION: 'us-central1',
  // Public test site key provided by Google for non-production use.
  VITE_FB_APP_CHECK_SITE_KEY: '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI',
  VITE_RECAPTCHA_SITE_KEY: '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI',
  VITE_FB_APP_CHECK_DEBUG_TOKEN: undefined,
  VITE_APPCHECK_DEBUG_TOKEN: undefined,
}

type RequiredFirebaseEnvKey = (typeof requiredEnvKeys)[number]

export type FirebaseEnvConfig = {
  apiKey: string
  authDomain: string
  projectId: string
  storageBucket: string
  appId: string
  functionsRegion: string
  appCheckSiteKey: string
  appCheckDebugToken?: string
}

type EnvSource = Record<string, string | boolean | undefined>

type GetRequiredEnvOptions = {
  allowDefaults: boolean
}

function getRequiredEnv(
  env: EnvSource,
  key: RequiredFirebaseEnvKey,
  options: GetRequiredEnvOptions,
): string {
  const value = options.allowDefaults
    ? env[key] ?? defaultFirebaseEnv[key]
    : env[key]
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim()
  }

  throw new Error(
    `[firebase-env] Missing required environment variable "${key}". ` +
      'Ensure this value is provided in your deployment configuration.'
  )
}

function getOptionalEnv(
  env: EnvSource,
  key: string,
  fallback: string,
  allowDefaults: boolean,
): string {
  const value = allowDefaults
    ? env[key] ?? defaultFirebaseEnv[key] ?? fallback
    : env[key]
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim()
  }

  return fallback
}

function getRequiredEnvOneOf(
  env: EnvSource,
  keys: readonly string[],
  options: GetRequiredEnvOptions,
): string {
  const allowDefaults = options.allowDefaults
  for (const key of keys) {
    const value = allowDefaults ? env[key] ?? defaultFirebaseEnv[key] : env[key]
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim()
    }
  }

  throw new Error(
    `[firebase-env] Missing required environment variable. ` +
      `Ensure one of the following keys is provided: ${keys.join(', ')}`,
  )
}

function getOptionalEnvOneOf(
  env: EnvSource,
  keys: readonly string[],
  allowDefaults: boolean,
): string | undefined {
  for (const key of keys) {
    const value = getOptionalEnv(env, key, '', allowDefaults).trim()
    if (value !== '') {
      return value
    }
  }

  return undefined
}

type CreateFirebaseEnvOptions = {
  allowDefaults?: boolean
}

export function createFirebaseEnv(
  env: EnvSource,
  options?: CreateFirebaseEnvOptions,
): FirebaseEnvConfig {
  const isProductionBuild =
    typeof env.PROD === 'boolean'
      ? env.PROD
      : typeof env.MODE === 'string'
        ? env.MODE.toLowerCase() === 'production'
        : false

  const allowDefaults = options?.allowDefaults ?? !isProductionBuild
  return {
    apiKey: getRequiredEnv(env, 'VITE_FB_API_KEY', { allowDefaults }),
    authDomain: getRequiredEnv(env, 'VITE_FB_AUTH_DOMAIN', { allowDefaults }),
    projectId: getRequiredEnv(env, 'VITE_FB_PROJECT_ID', { allowDefaults }),
    storageBucket: getRequiredEnv(env, 'VITE_FB_STORAGE_BUCKET', {
      allowDefaults,
    }),
    appId: getRequiredEnv(env, 'VITE_FB_APP_ID', { allowDefaults }),
    appCheckSiteKey: getRequiredEnvOneOf(env, appCheckSiteKeyEnvKeys, {
      allowDefaults,
    }),
    functionsRegion: getOptionalEnv(
      env,
      'VITE_FB_FUNCTIONS_REGION',
      'us-central1',
      allowDefaults,
    ),
    appCheckDebugToken: getOptionalEnvOneOf(
      env,
      appCheckDebugTokenEnvKeys,
      allowDefaults,
    ),
  }
}

export type FirebaseEnvLoadResult =
  | { ok: true; config: FirebaseEnvConfig }
  | { ok: false; error: Error }

function normalizeFirebaseEnvError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }

  try {
    return new Error(typeof error === 'string' ? error : JSON.stringify(error))
  } catch {
    return new Error('Unknown Firebase configuration error')
  }
}

export function loadFirebaseEnv(
  env: EnvSource,
  options?: CreateFirebaseEnvOptions,
): FirebaseEnvLoadResult {
  try {
    return { ok: true, config: createFirebaseEnv(env, options) }
  } catch (error) {
    return { ok: false, error: normalizeFirebaseEnvError(error) }
  }
}

const firebaseEnvResult = loadFirebaseEnv(import.meta.env)

const fallbackFirebaseEnv = createFirebaseEnv(defaultFirebaseEnv, { allowDefaults: true })

export const firebaseEnv = firebaseEnvResult.ok ? firebaseEnvResult.config : fallbackFirebaseEnv

export const firebaseEnvError = firebaseEnvResult.ok ? null : firebaseEnvResult.error

export { firebaseEnvResult }
