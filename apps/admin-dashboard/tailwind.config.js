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
        // Admin-specific colors
        admin: {
          primary: '#6366F1', // Indigo for admin
          secondary: '#8B5CF6', // Purple accent
        },
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
        // Status colors
        status: {
          active: '#22C55E',
          inactive: '#6B7280',
          pending: '#EAB308',
          error: '#EF4444',
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
