import type { TurnscopeDesktopApi } from '@shared/api'

declare global {
  interface Window {
    turnscope?: TurnscopeDesktopApi
  }
}

export {}
