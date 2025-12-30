import type { FormEventHandler, ReactNode } from 'react'
import './AuthForm.css'

type AuthFormProps = {
  title: string
  description?: string
  onSubmit: FormEventHandler<HTMLFormElement>
  submitLabel: string
  loading?: boolean
  error?: string | null
  footer?: ReactNode
  children: ReactNode
}

export function AuthForm({
  title,
  description,
  onSubmit,
  submitLabel,
  loading = false,
  error,
  footer,
  children,
}: AuthFormProps) {
  return (
    <form onSubmit={onSubmit} className="auth-form" noValidate data-auth-form>
      <div className="auth-form__header">
        <h1 className="auth-form__title">{title}</h1>
        {description ? <p className="auth-form__description">{description}</p> : null}
      </div>

      <div className="auth-form__body">{children}</div>

      {error ? (
        <p role="alert" className="auth-form__error">
          {error}
        </p>
      ) : null}

      <button type="submit" className="auth-form__submit" disabled={loading}>
        {loading ? 'Please wait…' : submitLabel}
      </button>

      {footer ? <div className="auth-form__footer">{footer}</div> : null}
    </form>
  )
}
export const authFormInputGroupClass = 'auth-form__field'

export const authFormLabelClass = 'auth-form__label'

export const authFormInputClass = 'auth-form__input'

export const authFormNoteClass = 'auth-form__note'
