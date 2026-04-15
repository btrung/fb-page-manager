/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        facebook: {
          blue: '#1877F2',
          dark: '#0d6efd',
          light: '#e7f3ff',
        },
      },
    },
  },
  plugins: [],
};
