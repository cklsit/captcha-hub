/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  // Preflight is disabled because MUI's <CssBaseline /> already provides a reset
  // and Tailwind's preflight would override MUI component styles.
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#5b8cff',
          soft: '#7c9cff',
        },
      },
      keyframes: {
        'highlight-pulse': {
          '0%': { boxShadow: '0 0 0 0 rgba(91,140,255,0.55)', backgroundColor: 'rgba(91,140,255,0.18)' },
          '70%': { boxShadow: '0 0 0 10px rgba(91,140,255,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(91,140,255,0)', backgroundColor: 'transparent' },
        },
        'slide-in': {
          '0%': { opacity: '0', transform: 'translateY(-8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'highlight-pulse': 'highlight-pulse 2.4s ease-out 1',
        'slide-in': 'slide-in 0.25s ease-out 1',
      },
    },
  },
  plugins: [],
};
