/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#1b1c24',
          dim: '#151620',
          raised: '#24252f',
          overlay: '#2e2f3b',
        },
        edge: {
          DEFAULT: '#333442',
          hover: '#44455a',
          active: '#55567a',
        },
        content: {
          DEFAULT: '#e4e4ec',
          muted: '#8e8ea0',
          faint: '#5c5c6e',
        },
        accent: {
          DEFAULT: '#c4916e',
          hover: '#d4a17e',
          muted: '#c4916e20',
        },
      },
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
