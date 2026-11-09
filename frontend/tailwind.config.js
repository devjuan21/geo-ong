/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./*.html",
    "./assets/js/**/*.js"
  ],
  theme: {
    extend: {
      colors: {
        cream: {
          50: '#FFFCF7',
          100: '#FFF9E8', // Warm cream primary background
          200: '#FFF3D0',
          300: '#FFEAB0',
        },
        gold: {
          50: '#FFFDF0',
          100: '#FFF9D2',
          200: '#FFF2A5',
          300: '#FFE872',
          400: '#FFDE40',
          500: '#F5B900', // Primary accent #F5B900
          600: '#D9A300',
          700: '#B88B00',
          800: '#8A6800',
          900: '#5C4500',
        },
        accent: {
          DEFAULT: '#F5B900', // Primary accent #F5B900
          hover: '#E5AC00',
          light: '#FFD54F', // Secondary accent #FFD54F
          soft: '#FFF6D6',
        },
        ink: {
          900: '#202020', // Main text #202020
          700: '#404040',
          500: '#777777', // Secondary text #777777
          400: '#999999',
          300: '#BDBDBD',
          200: '#EEEEEE', // Borders #EEEEEE
          100: '#F7F7F7',
        },
        emergency: {
          50: '#FFF1F1',
          100: '#FFE0E0',
          200: '#FFC2C2',
          300: '#FFA0A0',
          400: '#F87171',
          500: '#EF4444',
          600: '#D93636', // Emergency red: #D93636
          700: '#B82828',
          800: '#991B1B',
          900: '#7A1616',
        },
        safe: {
          50: '#F0FDF4',
          100: '#DCFCE7',
          500: '#278653', // Success green: #278653
          600: '#1F6F44',
          700: '#175734',
        },
        caution: {
          50: '#FFFDF0',
          100: '#FFF8E1',
          500: '#F5B900',
          600: '#E0A800',
          700: '#B88B00',
        },
        brand: {
          50: '#FFFDF5',
          100: '#FFF8E1',
          200: '#FFF2C6',
          300: '#FFE699',
          400: '#FFD54F',
          500: '#F5B900',
          600: '#DE9A00',
          700: '#B87B00',
          800: '#3D341C',
          900: '#202020',
          950: '#14120E',
        }
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        'subtle': '0 1px 3px 0 rgba(32, 32, 32, 0.04), 0 1px 2px -1px rgba(32, 32, 32, 0.03)',
        'card': '0 2px 10px 0 rgba(32, 32, 32, 0.04), 0 1px 3px -1px rgba(32, 32, 32, 0.03)',
        'card-hover': '0 10px 24px -4px rgba(32, 32, 32, 0.07), 0 4px 8px -2px rgba(32, 32, 32, 0.03)',
        'accent-glow': '0 4px 14px 0 rgba(245, 185, 0, 0.3)',
        'emergency-glow': '0 4px 14px 0 rgba(217, 54, 54, 0.3)',
        'modal': '0 20px 25px -5px rgba(32, 32, 32, 0.18), 0 8px 10px -6px rgba(32, 32, 32, 0.08)',
      }
    },
  },
  plugins: [],
}
