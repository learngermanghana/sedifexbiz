import { createContext, ReactNode, useContext } from 'react'

type PwaContextValue = {
  isPwaApp: boolean
}

const defaultValue: PwaContextValue = { isPwaApp: false }

const PwaContext = createContext<PwaContextValue>(defaultValue)

interface PwaProviderProps {
  children: ReactNode
  isPwaApp: boolean
}

export function PwaProvider({ children, isPwaApp }: PwaProviderProps) {
  return <PwaContext.Provider value={{ isPwaApp }}>{children}</PwaContext.Provider>
}

export function usePwaContext() {
  return useContext(PwaContext)
}
