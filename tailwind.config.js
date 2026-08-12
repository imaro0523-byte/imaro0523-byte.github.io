/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // System font stack only — no @font-face, no external font request ever.
        sans: [
          'Pretendard',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Malgun Gothic"',
          '"맑은 고딕"',
          '"Apple SD Gothic Neo"',
          '"Noto Sans KR"',
          'system-ui',
          'sans-serif',
        ],
      },
      colors: {
        // Okabe–Ito derived palette: distinguishable under the common
        // colour-vision deficiencies (deuteranopia / protanopia / tritanopia).
        group: {
          1: '#0072b2',
          2: '#e69f00',
          3: '#009e73',
          4: '#cc79a7',
          5: '#56b4e9',
          6: '#d55e00',
          7: '#8a6ee0',
          8: '#6b7280',
          9: '#b3651e',
          10: '#0f766e',
          11: '#9d174d',
          12: '#334155',
        },
      },
      keyframes: {
        'flip-in': {
          '0%': { transform: 'rotateY(90deg)', opacity: '0' },
          '100%': { transform: 'rotateY(0deg)', opacity: '1' },
        },
      },
      animation: {
        'flip-in': 'flip-in 320ms ease-out',
      },
    },
  },
  plugins: [],
};
