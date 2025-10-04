import type { CSSProperties, FormEventHandler, ReactNode } from 'react'
import { colors, gradients, overlays, radii, shadows } from '../../styles/themeTokens'

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
    <form onSubmit={onSubmit} style={formStyle} noValidate data-auth-form>
      <div style={headerStyle}>
        <h1 style={titleStyle}>{title}</h1>
        {description ? <p style={descriptionStyle}>{description}</p> : null}
      </div>

      <div style={bodyStyle}>{children}</div>

      {error ? (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      ) : null}

      <button type="submit" style={submitStyle} disabled={loading}>
        {loading ? 'Please wait…' : submitLabel}
      </button>

      {footer ? <div style={footerStyle}>{footer}</div> : null}
    </form>
  )
}

const formStyle: CSSProperties = {
  width: '100%',
  maxWidth: '420px',
  display: 'flex',
  flexDirection: 'column',
  gap: '1.5rem',
  backgroundColor: colors.surface,
  borderRadius: radii.xl,
  padding: '2.5rem',
  boxShadow: shadows.elevated,
}

const headerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
}

const titleStyle: CSSProperties = {
  fontSize: '1.75rem',
  fontWeight: 700,
  margin: 0,
  color: colors.textPrimary,
}

const descriptionStyle: CSSProperties = {
  margin: 0,
  fontSize: '1rem',
  lineHeight: 1.5,
  color: colors.textSecondary,
}

const bodyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
}

const submitStyle: CSSProperties = {
  appearance: 'none',
  border: 'none',
  borderRadius: radii.pill,
  background: gradients.auth,
  color: colors.textInverse,
  fontSize: '1rem',
  fontWeight: 600,
  padding: '0.85rem 1.5rem',
  cursor: 'pointer',
  transition: 'filter 150ms ease, transform 150ms ease',
  boxShadow: shadows.cta,
}

const errorStyle: CSSProperties = {
  margin: 0,
  padding: '0.75rem 1rem',
  borderRadius: radii.md,
  backgroundColor: colors.dangerSurface,
  color: colors.danger,
  fontSize: '0.95rem',
  border: `1px solid ${overlays.dangerOutline}`,
}

const footerStyle: CSSProperties = {
  textAlign: 'center',
  fontSize: '0.95rem',
  color: colors.textSecondary,
}

if (typeof window !== 'undefined') {
  const styleId = 'auth-form-hover-style'
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = `
      @media (hover: hover) and (pointer: fine) {
        form[data-auth-form] button[type="submit"]:not(:disabled) {
          transition: filter 150ms ease, transform 150ms ease;
        }
        form[data-auth-form] button[type="submit"]:not(:disabled):hover {
          filter: brightness(0.92);
          transform: translateY(1px);
        }
        form[data-auth-form] button[type="submit"]:not(:disabled):active {
          filter: brightness(0.88);
          transform: translateY(2px);
        }
        form[data-auth-form] button[type="submit"]:disabled {
          opacity: 0.65;
          cursor: not-allowed;
        }
      }
    `
    document.head.appendChild(style)
  }
}

export const inputGroupStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
}

export const labelStyle: CSSProperties = {
  fontWeight: 600,
  fontSize: '0.95rem',
  color: colors.textPrimary,
}

export const inputStyle: CSSProperties = {
  borderRadius: radii.md,
  border: '1px solid rgba(var(--color-border-input-rgb, 148, 163, 184), 0.6)',
  padding: '0.85rem 1rem',
  fontSize: '1rem',
  backgroundColor: colors.background,
  color: colors.textPrimary,
  transition: 'border-color 150ms ease, box-shadow 150ms ease, background-color 150ms ease',
}

export const noteStyle: CSSProperties = {
  fontSize: '0.85rem',
  color: colors.textMuted,
  margin: 0,
}
