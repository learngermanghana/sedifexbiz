import type { ReactElement, ReactNode } from 'react'
import './Workspace.css'

type PageSectionProps = {
  title: string
  subtitle?: string
  actions?: ReactNode
  children?: ReactNode
  className?: string
  cardClassName?: string
}

export default function PageSection({
  title,
  subtitle,
  actions,
  children,
  className,
  cardClassName,
}: PageSectionProps): ReactElement {
  const pageClassName = className ? `page ${className}` : 'page'
  const cardClasses = cardClassName ? `card ${cardClassName}` : 'card'

  return (
    <div className={pageClassName}>
      <header className="page__header">
        <div>
          <h2 className="page__title">{title}</h2>
          {subtitle ? <p className="page__subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="page__actions">{actions}</div> : null}
      </header>
      <section className={cardClasses}>{children}</section>
    </div>
  )
}
