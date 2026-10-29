'use client'

import { Toaster as Sonner, type ToasterProps } from 'sonner'

// shadcn's toast, without next-themes: this app has a single light theme.
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{ classNames: { toast: 'font-sans' } }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
