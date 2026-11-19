import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./ui/index.html', './ui/src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
