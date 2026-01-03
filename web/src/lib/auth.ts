import {
  PublicClientApplication,
  RedirectRequest,
  SilentRequest,
  AuthenticationResult,
} from '@azure/msal-browser'

/*
 * MSAL (Microsoft Authentication Library) configuration for the Sedifex web
 * application.  This module centralizes authentication logic so that pages
 * and hooks can sign users in and acquire access tokens for Microsoft Graph
 * calls without duplicating boilerplate.  Client identifiers and other
 * settings are sourced from Vite environment variables.  See the
 * accompanying integration guide for details on how to configure these
 * values in your .env file.
 */

const msalConfig = {
  auth: {
    // The client ID of your Azure AD application.  Define VITE_AZURE_AD_CLIENT_ID
    // in your environment (e.g., .env file) when running the app.
    clientId: import.meta.env.VITE_AZURE_AD_CLIENT_ID as string,
    // The authority combines the login endpoint and tenant ID.  For single
    // tenant apps, specify your tenant ID via VITE_AZURE_AD_TENANT_ID.  For
    // multi‑tenant apps you can use 'common' instead.
    authority: `https://login.microsoftonline.com/${
      import.meta.env.VITE_AZURE_AD_TENANT_ID || 'common'
    }`,
    // The redirect URI where Azure AD will return tokens.  Must exactly
    // match one of the Redirect URIs configured in your app registration.
    redirectUri:
      (import.meta.env.VITE_AZURE_AD_REDIRECT_URI as string) ||
      window.location.origin,
  },
  cache: {
    // Use localStorage so that sessions persist across tabs and reloads.
    cacheLocation: 'localStorage' as const,
    // Do not store the auth state in cookies unless you need legacy browser
    // support (e.g., IE11).
    storeAuthStateInCookie: false,
  },
}

// Scopes that will be requested during login and token acquisition.  The
// 'User.Read' scope is required by Microsoft Graph to read user profile
// information, while 'Files.ReadWrite.All' and 'Sites.ReadWrite.All'
// enable reading and writing Excel files in OneDrive or SharePoint.
const defaultScopes = [
  'User.Read',
  'Files.ReadWrite.All',
  'Sites.ReadWrite.All',
]

const loginRequest: RedirectRequest = {
  scopes: defaultScopes,
}

// Create a single MSAL application instance for the entire app lifecycle.
export const msalInstance = new PublicClientApplication(msalConfig)

/**
 * Initiate an interactive sign‑in via redirect.  If a user is already
 * signed in, this function resolves immediately with the account.  When
 * using redirect flow the page will reload; after redirect the user will
 * be signed in and cached in the MSAL instance.
 */
export async function signIn(): Promise<void | AuthenticationResult> {
  const accounts = msalInstance.getAllAccounts()
  if (accounts.length > 0) {
    return { account: accounts[0] } as AuthenticationResult
  }
  // Trigger a redirect login.  Control will return after authentication.
  return msalInstance.loginRedirect(loginRequest)
}

/**
 * Sign out the currently authenticated user.  This will clear their
 * session from both MSAL and the Azure AD session.  After sign‑out the
 * user will need to re‑authenticate to call protected APIs.
 */
export async function signOut(): Promise<void> {
  const accounts = msalInstance.getAllAccounts()
  if (accounts.length > 0) {
    await msalInstance.logoutRedirect({ account: accounts[0] })
  }
}

/**
 * Acquire an access token for Microsoft Graph.  Attempts silent token
 * acquisition using cached credentials; if this fails (e.g., token
 * expired) the user will be redirected to login.  The returned string is
 * the bearer token to be sent in the Authorization header of Graph API
 * requests.
 */
export async function acquireAccessToken(): Promise<string> {
  const accounts = msalInstance.getAllAccounts()
  if (accounts.length === 0) {
    // If no user is signed in, start the login process.
    await msalInstance.loginRedirect(loginRequest)
    throw new Error('Redirecting to login')
  }
  const silentRequest: SilentRequest = {
    scopes: defaultScopes,
    account: accounts[0],
  }
  try {
    const result = await msalInstance.acquireTokenSilent(silentRequest)
    return result.accessToken
  } catch (error) {
    // Fallback to interactive token acquisition.  This will redirect
    // the browser to Azure AD and return after sign‑in.
    await msalInstance.acquireTokenRedirect(silentRequest)
    throw new Error('Redirecting to acquire token')
  }
}

/**
 * Convenience hook for React components.  This hook triggers login on
 * initial render if no account is present and provides a function to
 * retrieve an access token.  Example usage:
 *
 *   const { signInIfNeeded, getToken } = useMsalAuth()
 *   useEffect(() => { signInIfNeeded() }, [])
 *   async function handleExport() {
 *     const token = await getToken()
 *     // call Graph API with token
 *   }
 */
export function useMsalAuth() {
  async function signInIfNeeded() {
    const accounts = msalInstance.getAllAccounts()
    if (accounts.length === 0) {
      await msalInstance.loginRedirect(loginRequest)
    }
  }
  async function getToken() {
    return acquireAccessToken()
  }
  return { signInIfNeeded, getToken }
}