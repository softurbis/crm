// Chequeo mínimo pero implacable con lo que el build NO ve: usar una variable
// antes de declararla revienta en el navegador (pantalla en blanco) y compila
// perfecto. Paso el 18 ago con el dashboard.
import js from '@eslint/js'
import globals from 'globals'

export default [
  { ignores: ['dist/**', 'node_modules/**', 'agente/**', 'worker/**', 'scripts/**'] },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // OJO: 'variables: true' marca tambien los usos dentro de callbacks, que en
      // ejecucion son legales (el callback corre despues del render). Por eso queda
      // como AVISO: sirve para revisar el archivo que uno toca, no como barrera.
      'no-use-before-define': ['warn', { functions: false, classes: false, variables: true }],
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-const-assign': 'error',
    },
  },
]
