/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from 'react'

const RouterContext = createContext(null)

// Optional global navigation lock (used while a timed assessment/exam is running).
// When locked, in-app navigation and the browser back button are ignored so the
// user cannot leave the screen until the lock is released.
let navLockPath = null
let navBlockedHandler = null

export function setNavigationLock(active, path = window.location.pathname) {
  navLockPath = active ? path : null
}

export function setNavigationBlockedHandler(handler) {
  navBlockedHandler = handler
}

export function RouterProvider({ children }) {
  const [pathname, setPathname] = useState(window.location.pathname)
  useEffect(() => {
    const update = () => {
      if (navLockPath) {
        window.history.pushState({}, '', navLockPath)
        navBlockedHandler?.()
        return
      }
      setPathname(window.location.pathname)
    }
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])
  const value = useMemo(() => ({
    location: { pathname },
    navigate(path) {
      if (path === window.location.pathname) return
      if (navLockPath) {
        navBlockedHandler?.()
        return
      }
      window.history.pushState({}, '', path)
      setPathname(path)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
  }), [pathname])
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export const useNavigate = () => useContext(RouterContext).navigate
export const useLocation = () => useContext(RouterContext).location
