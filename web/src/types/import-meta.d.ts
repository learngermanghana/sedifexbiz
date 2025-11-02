interface ImportMetaEnv {
  readonly BASE_URL: string
  readonly VITE_FB_API_KEY: string
  readonly VITE_FB_AUTH_DOMAIN: string
  readonly VITE_FB_PROJECT_ID: string
  readonly VITE_FB_STORAGE_BUCKET: string
  readonly VITE_FB_APP_ID: string
  readonly VITE_FB_FUNCTIONS_REGION?: string
  readonly VITE_FB_APP_CHECK_SITE_KEY: string
  readonly VITE_FB_APP_CHECK_DEBUG_TOKEN?: string
  readonly VITE_RECAPTCHA_SITE_KEY?: string
  readonly VITE_APPCHECK_DEBUG_TOKEN?: string
  readonly VITE_HEARTBEAT_URL?: string
  readonly VITE_PAYSTACK_PUBLIC_KEY?: string
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_SUPABASE_FUNCTIONS_URL?: string
  readonly VITE_OVERRIDE_TEAM_MEMBER_DOC_ID?: string
  readonly VITE_SIGNUP_PAYMENT_URL?: string
}

declare interface ImportMeta {
  readonly env: ImportMetaEnv
}
