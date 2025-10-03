import type { PropsWithChildren, ReactElement } from 'react'

export default function Gate({ children }: PropsWithChildren): ReactElement {
  return <>{children}</>
}
