import { useActiveStoreContext, type ActiveStoreContextValue } from '../utils/activeStore'

export function useActiveStore(): ActiveStoreContextValue {
  return useActiveStoreContext()
}
