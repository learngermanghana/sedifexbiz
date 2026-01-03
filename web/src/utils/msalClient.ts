// web/src/utils/msalClient.ts
import {
  PublicClientApplication,
  AccountInfo,
  AuthenticationResult,
} from '@azure/msal-browser'

const clientId = import.meta.env.VITE_MSAL_CLIENT_ID || ''
// You can also make TENANT configurable if you like
const authority =
  import.meta.env.VITE_MSAL_AUTHORITY ||
  'https://login.microsoftonline.com/common'

if (!clientId) {
  // Optional: log a warning so you remember to set env
  console.warn(
    '[MSAL] VITE_MSAL_CLIENT_ID is not set. Microsoft login will not work until this is configured.'
  )
}

const msalConfig = {
  auth: {
    clientId,
    authority,
    redirectUri: window.location.origin, // popup flow, so this is fine
  },
  cache: {
    cacheLocation: 'localStorage' as const,
    storeAuthStateInCookie: false,
  },
}

const msalInstance = new PublicClientApplication(msalConfig)

export function getMsalInstance() {
  return msalInstance
}

/**
 * Interactive sign-in via popup.
 * Returns the logged-in account or undefined if user closed the popup.
 */
export async function signInWithMicrosoft(
  scopes: string[] = ['Files.ReadWrite.All', 'Sites.ReadWrite.All']
): Promise<AccountInfo | undefined> {
  const existingAccounts = msalInstance.getAllAccounts()
  if (existingAccounts.length > 0) {
    return existingAccounts[0]
  }

  try {
    const loginResult: AuthenticationResult = await msalInstance.loginPopup({
      scopes,
    })
    return loginResult.account ?? undefined
  } catch (err: any) {
    // user cancelled popup
    if (err && err.errorCode === 'user_cancelled') {
      console.info('[MSAL] User cancelled sign-in.')
      return undefined
    }
    console.error('[MSAL] loginPopup failed', err)
    throw err
  }
}

/**
 * Get an access token silently (no popup).
 * Assumes there is at least one signed-in account.
 */
export async function acquireGraphToken(
  scopes: string[] = ['Files.ReadWrite.All', 'Sites.ReadWrite.All']
): Promise<string> {
  const accounts = msalInstance.getAllAccounts()
  if (accounts.length === 0) {
    throw new Error('No signed-in Microsoft account found')
  }

  const result = await msalInstance.acquireTokenSilent({
    scopes,
    account: accounts[0],
  })

  return result.accessToken
}
