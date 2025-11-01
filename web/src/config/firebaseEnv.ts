const requiredEnvKeys = [
  'VITE_FB_API_KEY',
  'VITE_FB_AUTH_DOMAIN',
  'VITE_FB_PROJECT_ID',
  'VITE_FB_STORAGE_BUCKET',
  'VITE_FB_APP_ID',
] as const

const defaultFirebaseEnv: Record<string, string | undefined> = {
  VITE_FB_API_KEY: 'AIzaSyDwqED5PminaTUDRAquyFMhSA6vroj1Ccw',
  VITE_FB_AUTH_DOMAIN: 'sedifex-ac2b0.firebaseapp.com',
  VITE_FB_PROJECT_ID: 'sedifex-ac2b0',
  VITE_FB_STORAGE_BUCKET: 'sedifex-ac2b0.appspot.com',
  VITE_FB_APP_ID: '1:519571382805:web:d0f4653d62a71dfa58a41c',
  VITE_FB_FUNCTIONS_REGION: 'us-central1',
}

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

type CreateFirebaseEnvOptions = {
  allowDefaults?: boolean
}

export function createFirebaseEnv(
  env: EnvSource,
  options?: CreateFirebaseEnvOptions,
): FirebaseEnvConfig {
  const allowDefaults = options?.allowDefaults ?? true
  return {
    apiKey: getRequiredEnv(env, 'VITE_FB_API_KEY', { allowDefaults }),
    authDomain: getRequiredEnv(env, 'VITE_FB_AUTH_DOMAIN', { allowDefaults }),
    projectId: getRequiredEnv(env, 'VITE_FB_PROJECT_ID', { allowDefaults }),
    storageBucket: getRequiredEnv(env, 'VITE_FB_STORAGE_BUCKET', {
      allowDefaults,
    }),
    appId: getRequiredEnv(env, 'VITE_FB_APP_ID', { allowDefaults }),
    functionsRegion: getOptionalEnv(
      env,
      'VITE_FB_FUNCTIONS_REGION',
      'us-central1',
      allowDefaults,
    ),
  }
}

export const firebaseEnv = createFirebaseEnv(import.meta.env)
