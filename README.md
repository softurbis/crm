# Urbis Control v2

Sistema en producción: https://softurbis.github.io/crm/

Sistema web de gestión inmobiliaria de Urbis Group (React 19 + Vite + Supabase).

## Puesta en marcha

1. **Base de datos**: ejecutar `sql/01_schema_urbis_control_v2.sql` en el SQL Editor de Supabase (una sola vez).
2. **Variables**: copiar `.env.example` a `.env` y pegar la `anon key` (Supabase → Settings → API).
3. **Instalar y correr**:
   ```bash
   npm install
   npm run dev
   ```
4. **Primer usuario**: Supabase → Authentication → Add user (correo + contraseña). Luego en SQL Editor:
   ```sql
   update profiles set role = 'admin' where email = 'tu@correo.com';
   ```

## Subir a GitHub (primera vez)

```bash
git init
git add .
git commit -m "Urbis Control v2 - base"
git branch -M main
git remote add origin https://github.com/softurbis/crm.git
git push -u origin main
```

## Estructura

- `src/lib/supabase.js` — conexión a Supabase
- `src/context/AuthContext.jsx` — sesión y rol del usuario
- `src/components/Layout.jsx` — menú lateral (responsive)
- `src/pages/` — un archivo por módulo

## Roadmap

- **Fase 1**: 10 módulos originales + Leads (Kanban)
- **Fase 2**: Meta WhatsApp Cloud API + Calendario de visitas + Agente de cobranza
- **Fase 3**: Agente de seguimiento + control de actividades
- **Fase 4**: reportes avanzados
