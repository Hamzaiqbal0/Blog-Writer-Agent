
import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: { darkMode: 'class',
    extend: {},
  },
  plugins: [require('@tailwindcss/typography')],
}
export default config


