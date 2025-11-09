// web/src/config/firebaseEnv.ts
import runtimeEnv from './runtimeEnv'

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
  // Default to your Enterprise site key
  VITE_FB_APP_CHECK_SITE_KEY: '6LcVMf8rAAAAAOpbzgdKCikJB7glk7slfrfHvtum',
  VITE_RECAPTCHA_SITE_KEY: '6LcVMf8rAAAAAOpbzgdKCikJB7glk7slfrfHvtum',
  VITE_FB_APP_CHECK_DEBUG_TOKEN: '967EB4EB-6354-494F-8C62-48F5B1F6B07F',
  VITE_APPCHECK_DEBUG_TOKEN: '967EB4EB-6354-494F-8C62-48F5B1F6B07F',
}

const DEFAULT_FUNCTIONS_REGION = 'us-central1'

type RequiredFirebaseEnvKey = (typeof requiredEnvKeys)[number]

type EnvSource = Record<string, string | boolean | undefined>
type GetRequiredEnvOptions = { allowDefaults: boolean }

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

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function isTruthy(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === 'true' || normalized === '1'
  }

  return false
}

function getEnvValue(
  key: string,
  source: EnvSource,
  allowDefaults: boolean,
  { fallback }: { fallback?: string } = {},
): string | undefined {
  const directValue = normalizeString(source[key])
  if (directValue) {
    return directValue
  }

  if (allowDefaults) {
    const defaultValue = normalizeString(defaultFirebaseEnv[key])
    if (defaultValue) {
      return defaultValue
    }
  }

  if (fallback) {
    return fallback
  }

  return undefined
}

function getRequiredEnvValue(
  key: RequiredFirebaseEnvKey,
  source: EnvSource,
  options: GetRequiredEnvOptions,
): string {
  const value = getEnvValue(key, source, options.allowDefaults)

  if (!value) {
    throw new Error(`Missing required environment variable "${key}".`)
  }

  return value
}

function getFirstAvailableValue(
  keys: readonly string[],
  source: EnvSource,
  options: GetRequiredEnvOptions,
): string | undefined {
  for (const key of keys) {
    const value = getEnvValue(key, source, options.allowDefaults)
    if (value) {
      return value
    }
  }

  return undefined
}

export function createFirebaseEnv(
  source: EnvSource = runtimeEnv,
  options?: Partial<GetRequiredEnvOptions>,
): FirebaseEnvConfig {
  const allowDefaults = options?.allowDefaults ?? !isTruthy(source.PROD)
  const resolvedOptions: GetRequiredEnvOptions = { allowDefaults }

  const apiKey = getRequiredEnvValue('VITE_FB_API_KEY', source, resolvedOptions)
  const authDomain = getRequiredEnvValue('VITE_FB_AUTH_DOMAIN', source, resolvedOptions)
  const projectId = getRequiredEnvValue('VITE_FB_PROJECT_ID', source, resolvedOptions)
  const storageBucket = getRequiredEnvValue('VITE_FB_STORAGE_BUCKET', source, resolvedOptions)
  const appId = getRequiredEnvValue('VITE_FB_APP_ID', source, resolvedOptions)

  const functionsRegion =
    getEnvValue('VITE_FB_FUNCTIONS_REGION', source, resolvedOptions.allowDefaults, {
      fallback: DEFAULT_FUNCTIONS_REGION,
    }) ?? DEFAULT_FUNCTIONS_REGION

  const appCheckSiteKey = getFirstAvailableValue(appCheckSiteKeyEnvKeys, source, resolvedOptions)
  if (!appCheckSiteKey) {
    throw new Error(
      `Missing required environment variable "${appCheckSiteKeyEnvKeys.join('" or "')}".`,
    )
  }

  const appCheckDebugToken = getFirstAvailableValue(appCheckDebugTokenEnvKeys, source, resolvedOptions)

  return {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    appId,
    functionsRegion,
    appCheckSiteKey,
    appCheckDebugToken,
  }
}

let firebaseEnvError: Error | null = null
let firebaseEnv: FirebaseEnvConfig

try {
  firebaseEnv = createFirebaseEnv(runtimeEnv)
} catch (error) {
  firebaseEnvError = error instanceof Error ? error : new Error(String(error))
  firebaseEnv = createFirebaseEnv(runtimeEnv, { allowDefaults: true })
}

export { firebaseEnv, firebaseEnvError }
export type { EnvSource, GetRequiredEnvOptions }

export default firebaseEnv
