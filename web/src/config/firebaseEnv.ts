const requiredEnvKeys = [
  'VITE_FB_API_KEY',
  'VITE_FB_AUTH_DOMAIN',
  'VITE_FB_PROJECT_ID',
  'VITE_FB_STORAGE_BUCKET',
  'VITE_FB_APP_ID',
] as const

type RequiredFirebaseEnvKey = (typeof requiredEnvKeys)[number]

export type FirebaseEnvConfig = {
  apiKey: string
  authDomain: string
  projectId: string
  storageBucket: string
  appId: string
  functionsRegion: string
}

type EnvSource = Record<string, string | undefined>

function getRequiredEnv(env: EnvSource, key: RequiredFirebaseEnvKey): string {
  const value = env[key]
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim()
  }

  throw new Error(
    `[firebase-env] Missing required environment variable "${key}". ` +
      'Ensure this value is provided in your deployment configuration.'
  )
}

function getOptionalEnv(env: EnvSource, key: string, fallback: string): string {
  const value = env[key]
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim()
  }

  return fallback
}

export function createFirebaseEnv(env: EnvSource): FirebaseEnvConfig {
  return {
    apiKey: getRequiredEnv(env, 'VITE_FB_API_KEY'),
    authDomain: getRequiredEnv(env, 'VITE_FB_AUTH_DOMAIN'),
    projectId: getRequiredEnv(env, 'VITE_FB_PROJECT_ID'),
    storageBucket: getRequiredEnv(env, 'VITE_FB_STORAGE_BUCKET'),
    appId: getRequiredEnv(env, 'VITE_FB_APP_ID'),
    functionsRegion: getOptionalEnv(env, 'VITE_FB_FUNCTIONS_REGION', 'us-central1'),
  }
}

export const firebaseEnv = createFirebaseEnv(import.meta.env)
