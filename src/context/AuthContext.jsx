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

  // BANDERAS DE ROL, calculadas una sola vez para todo el panel (1 oct 2026, rol
  // OPERADOR). Las pantallas las leen en vez de comparar el texto del rol:
  //   esSuper       el superusuario. Lo de ADMINISTRACIÓN sigue siendo solo suyo:
  //                 usuarios, bitácora, números y ajustes del bot, agentes IA.
  //   esOperador    trabaja como el superusuario (corrige, migra, edita) pero no
  //                 ve esas pantallas de administración.
  //   puedeCorregir lo que antes era "solo el superusuario corrige, borra o migra".
  //   esJefe        administrador, superusuario u operador: ve todos los proyectos
  //                 y edita todo lo del trabajo diario.
  // En la base el operador vale como 'admin' (get_user_role); lo que distingue
  // al operador del superusuario se decide aquí, en el panel.
  const role = profile?.role
  const esSuper = role === 'superuser'
  const esOperador = role === 'operador'
  const puedeCorregir = esSuper || esOperador
  const esJefe = role === 'admin' || puedeCorregir

  return (
    <AuthContext.Provider value={{ session, profile, role, esSuper, esOperador, puedeCorregir, esJefe, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
