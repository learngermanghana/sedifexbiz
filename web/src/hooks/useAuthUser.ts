import { createContext, useContext } from 'react'
import type { User } from '../supabaseClient'

export const AuthUserContext = createContext<User | null>(null)

export function useAuthUser() {
  return useContext(AuthUserContext)
}
