/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Healthcare-specific severity colors
        severity: {
          info: {
            DEFAULT: '#3B82F6',
            light: '#EFF6FF',
            dark: '#1E40AF',
          },
          warning: {
            DEFAULT: '#F59E0B',
            light: '#FFFBEB',
            dark: '#B45309',
          },
          critical: {
            DEFAULT: '#F97316',
            light: '#FFF7ED',
            dark: '#C2410C',
          },
          contraindicated: {
            DEFAULT: '#EF4444',
            light: '#FEF2F2',
            dark: '#B91C1C',
          },
        },
        // Priority colors for review queue
        priority: {
          p0: '#DC2626', // Critical - Red
          p1: '#F97316', // High - Orange
          p2: '#EAB308', // Medium - Yellow
          p3: '#6B7280', // Low - Gray
        },
        // Validation tier colors
        validation: {
          high: '#22C55E',    // Green
          review: '#EAB308',  // Yellow
          blocked: '#EF4444', // Red
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
