/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from 'react'

const RouterContext = createContext(null)

export function RouterProvider({ children }) {
  const [pathname, setPathname] = useState(window.location.pathname)
  useEffect(() => {
    const update = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])
  const value = useMemo(() => ({
    location: { pathname },
    navigate(path) {
      if (path === window.location.pathname) return
      window.history.pushState({}, '', path)
      setPathname(path)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
  }), [pathname])
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export const useNavigate = () => useContext(RouterContext).navigate
export const useLocation = () => useContext(RouterContext).location
