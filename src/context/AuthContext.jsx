import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((ev, s) => {
      // El token se renueva solo cada ~55 minutos, y ese evento NO es un cambio
      // de usuario. Antes se pasaba tal cual: el arbol entero recargaba perfil y
      // proyectos cada hora, y si la renovacion tropezaba un instante la sesion
      // quedaba nula un momento -> App mandaba a /login y de vuelta -> el
      // formulario a medio llenar moria en el viaje (pasaba registrando cuotas).
      if (ev === 'SIGNED_OUT') {
        // ¿cierre de verdad o tropiezo de la renovacion? Se confirma antes de
        // expulsar: si getSession aun tiene sesion, no ha pasado nada.
        supabase.auth.getSession().then(({ data }) => setSession(data.session || null))
        return
      }
      // mismo usuario = misma sesion para React (la libreria ya guarda el token
      // nuevo por dentro); asi la renovacion no dispara ninguna recarga
      setSession(prev => (prev && s && prev.user?.id === s.user?.id) ? prev : s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user) { setProfile(null); return }
    supabase.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data }) => {
        if (data && data.active === false) { supabase.auth.signOut(); setProfile(null); return }
        setProfile(data)
      })
  }, [session])

  const login = (email, password) => supabase.auth.signInWithPassword({ email, password })
  const logout = () => supabase.auth.signOut()

  return (
    <AuthContext.Provider value={{ session, profile, role: profile?.role, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
