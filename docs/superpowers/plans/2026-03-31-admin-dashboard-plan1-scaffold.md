# Admin Dashboard Plan 1: Project Scaffold + Dashboard + GraphQL Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a working standalone Next.js admin app that lists all clinical pathways from the backend, with status badges, filtering, and navigation structure.

**Architecture:** Standalone Next.js 16 app (`prism-admin-dashboard/`) at the workspace root, same level as `prism-provider-front-end/`. Connects to the existing gateway on port 4000 via Apollo Client. Follows the same patterns as the provider frontend (App Router, Tailwind CSS 4, `@/*` path alias) but with no auth layer.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Apollo Client 4, Tailwind CSS 4, Heroicons, clsx

**Spec:** `prism-graphql/docs/superpowers/specs/2026-03-31-admin-dashboard-pathway-editor-design.md`

---

## File Structure

```
workspace/prism-admin-dashboard/
├── package.json
├── next.config.ts
├── tsconfig.json
├── postcss.config.mjs
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout with sidebar
│   │   ├── page.tsx                # Dashboard — pathway list
│   │   ├── providers.tsx           # ApolloProvider wrapper
│   │   └── globals.css             # Tailwind + design tokens
│   ├── components/
│   │   ├── layout/
│   │   │   └── Sidebar.tsx         # Admin sidebar navigation
│   │   ├── dashboard/
│   │   │   ├── PathwayTable.tsx    # Pathway list table with sorting
│   │   │   └── StatusBadge.tsx     # DRAFT/ACTIVE/ARCHIVED/SUPERSEDED badges
│   │   └── ui/
│   │       ├── Button.tsx          # Reusable button component
│   │       └── Spinner.tsx         # Loading spinner
│   ├── lib/
│   │   ├── apollo-client.ts        # Apollo Client singleton (no auth)
│   │   ├── apollo-provider.tsx     # React context wrapper
│   │   └── graphql/
│   │       └── queries/
│   │           └── pathways.ts     # GET_PATHWAYS, GET_PATHWAY queries
│   └── types/
│       └── index.ts                # Pathway, PathwayStatus, PathwayCategory types
```

---

### Task 1: Initialize Next.js Project

**Files:**
- Create: `prism-admin-dashboard/package.json`
- Create: `prism-admin-dashboard/next.config.ts`
- Create: `prism-admin-dashboard/tsconfig.json`
- Create: `prism-admin-dashboard/postcss.config.mjs`
- Create: `prism-admin-dashboard/.gitignore`

- [ ] **Step 1: Create project directory**

Run:
```bash
mkdir -p /home/claude/workspace/prism-admin-dashboard
```

- [ ] **Step 2: Create package.json**

Create `prism-admin-dashboard/package.json`:
```json
{
  "name": "prism-admin-dashboard",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3001",
    "build": "next build",
    "start": "next start -p 3001",
    "lint": "eslint"
  },
  "dependencies": {
    "@apollo/client": "4.1.4",
    "@heroicons/react": "2.2.0",
    "clsx": "2.1.1",
    "graphql": "16.12.0",
    "next": "16.1.6",
    "react": "19.2.3",
    "react-dom": "19.2.3"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.1.6",
    "tailwindcss": "^4",
    "typescript": "^5"
  }
}
```

Note: dependency versions match `prism-provider-front-end/package.json` exactly for consistency.

- [ ] **Step 3: Create tsconfig.json**

Create `prism-admin-dashboard/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts",
    "**/*.mts"
  ],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create next.config.ts**

Create `prism-admin-dashboard/next.config.ts`:
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/graphql',
        destination: process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://localhost:4000/graphql',
      },
    ];
  },
};

export default nextConfig;
```

- [ ] **Step 5: Create postcss.config.mjs**

Create `prism-admin-dashboard/postcss.config.mjs`:
```javascript
/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

- [ ] **Step 6: Create .gitignore**

Create `prism-admin-dashboard/.gitignore`:
```
# dependencies
/node_modules

# next.js
/.next/
/out/

# production
/build

# misc
.DS_Store
*.pem

# debug
npm-debug.log*

# env files
.env*.local

# typescript
*.tsbuildinfo
next-env.d.ts
```

- [ ] **Step 7: Install dependencies**

Run:
```bash
npm --prefix /home/claude/workspace/prism-admin-dashboard install
```

Expected: Clean install, no errors. `node_modules/` created.

- [ ] **Step 8: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard init
git -C /home/claude/workspace/prism-admin-dashboard add -A
git -C /home/claude/workspace/prism-admin-dashboard commit -m "chore: initialize Next.js 16 project scaffold"
```

---

### Task 2: Global Styles + Design Tokens

**Files:**
- Create: `prism-admin-dashboard/src/app/globals.css`

- [ ] **Step 1: Create globals.css with Tailwind and design tokens**

Create `prism-admin-dashboard/src/app/globals.css`:
```css
@import "tailwindcss";

/* ============================================
   PRISM ADMIN DESIGN SYSTEM
   ============================================ */

:root {
  /* Primary Colors — matches provider frontend */
  --primary-50: #eff6ff;
  --primary-100: #dbeafe;
  --primary-200: #bfdbfe;
  --primary-300: #93c5fd;
  --primary-400: #60a5fa;
  --primary-500: #3b82f6;
  --primary-600: #2563eb;
  --primary-700: #1d4ed8;
  --primary-800: #1e40af;
  --primary-900: #1e3a8a;

  /* Semantic Colors */
  --success-50: #f0fdfa;
  --success-500: #14b8a6;
  --success-600: #0d9488;

  --warning-50: #fffbeb;
  --warning-500: #f59e0b;
  --warning-600: #d97706;

  --danger-50: #fef2f2;
  --danger-500: #ef4444;
  --danger-600: #dc2626;

  /* Admin-specific: subtle purple accent for admin context */
  --admin-50: #faf5ff;
  --admin-500: #a855f7;
  --admin-600: #9333ea;

  /* Pathway Status Colors */
  --status-draft: #f59e0b;
  --status-active: #14b8a6;
  --status-archived: #6b7280;
  --status-superseded: #8b5cf6;

  /* Layout */
  --sidebar-width: 256px;
  --sidebar-collapsed-width: 80px;
}

/* Base body styles */
body {
  font-family: var(--font-inter, system-ui, -apple-system, sans-serif);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Animations */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideInLeft {
  from { transform: translateX(-100%); }
  to { transform: translateX(0); }
}

.animate-fadeIn {
  animation: fadeIn 0.2s ease-out;
}

.animate-slideInLeft {
  animation: slideInLeft 0.3s ease-out;
}
```

- [ ] **Step 2: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/app/globals.css
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add global styles and design tokens"
```

---

### Task 3: TypeScript Types

**Files:**
- Create: `prism-admin-dashboard/src/types/index.ts`

- [ ] **Step 1: Create shared types**

Create `prism-admin-dashboard/src/types/index.ts`:
```typescript
// Pathway types — mirrors pathway-service GraphQL schema

export type PathwayStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED' | 'SUPERSEDED';

export type PathwayCategory =
  | 'CHRONIC_DISEASE'
  | 'ACUTE_CARE'
  | 'PREVENTIVE_CARE'
  | 'POST_PROCEDURE'
  | 'MEDICATION_MANAGEMENT'
  | 'LIFESTYLE_MODIFICATION'
  | 'MENTAL_HEALTH'
  | 'PEDIATRIC'
  | 'GERIATRIC'
  | 'OBSTETRIC';

export interface Pathway {
  id: string;
  logicalId: string;
  title: string;
  version: string;
  category: PathwayCategory;
  status: PathwayStatus;
  conditionCodes: string[];
  scope: string | null;
  targetPopulation: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ImportMode = 'NEW_PATHWAY' | 'DRAFT_UPDATE' | 'NEW_VERSION';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ImportDiffSummary {
  nodesAdded: number;
  nodesRemoved: number;
  nodesModified: number;
  edgesAdded: number;
  edgesRemoved: number;
  edgesModified: number;
}

export interface DiffDetail {
  entityType: string;
  action: string;
  entityId: string;
  entityLabel: string;
}

export interface ImportDiff {
  summary: ImportDiffSummary;
  details: DiffDetail[];
  synthetic: boolean;
}

export interface ImportPathwayResult {
  pathway: Pathway | null;
  validation: ValidationResult;
  diff: ImportDiff | null;
  importType: ImportMode;
}

export interface PathwayStatusResult {
  pathway: Pathway;
  previousStatus: PathwayStatus;
}
```

- [ ] **Step 2: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/types/index.ts
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add TypeScript types for pathway data model"
```

---

### Task 4: Apollo Client Setup

**Files:**
- Create: `prism-admin-dashboard/src/lib/apollo-client.ts`
- Create: `prism-admin-dashboard/src/lib/apollo-provider.tsx`
- Create: `prism-admin-dashboard/src/app/providers.tsx`

- [ ] **Step 1: Create Apollo Client singleton**

Create `prism-admin-dashboard/src/lib/apollo-client.ts`:
```typescript
import { ApolloClient, InMemoryCache, HttpLink, from } from '@apollo/client/core';
import { ErrorLink } from '@apollo/client/link/error';
import { CombinedGraphQLErrors } from '@apollo/client/errors';

const httpLink = new HttpLink({
  uri: typeof window !== 'undefined'
    ? '/graphql'
    : (process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://localhost:4000/graphql'),
});

const errorLink = new ErrorLink(({ error }) => {
  if (CombinedGraphQLErrors.is(error)) {
    error.errors.forEach((graphqlError) => {
      console.error(
        `[GraphQL error]: ${graphqlError.message}`,
        graphqlError.locations,
        graphqlError.path
      );
    });
  } else {
    console.error(`[Network error]: ${error}`);
  }
});

let apolloClient: ApolloClient | null = null;

function createApolloClient(): ApolloClient {
  return new ApolloClient({
    ssrMode: typeof window === 'undefined',
    link: from([errorLink, httpLink]),
    cache: new InMemoryCache({
      typePolicies: {
        Pathway: {
          keyFields: ['id'],
        },
      },
    }),
    defaultOptions: {
      watchQuery: {
        fetchPolicy: 'cache-and-network',
        errorPolicy: 'all',
      },
      query: {
        fetchPolicy: 'cache-first',
        errorPolicy: 'all',
      },
      mutate: {
        errorPolicy: 'all',
      },
    },
  });
}

export function getApolloClient(): ApolloClient {
  if (typeof window === 'undefined') {
    return createApolloClient();
  }
  if (!apolloClient) {
    apolloClient = createApolloClient();
  }
  return apolloClient;
}
```

Note: No auth link — the admin dashboard runs without authentication per spec.

- [ ] **Step 2: Create Apollo Provider component**

Create `prism-admin-dashboard/src/lib/apollo-provider.tsx`:
```tsx
'use client';

import { ApolloProvider as BaseApolloProvider } from '@apollo/client/react';
import { getApolloClient } from './apollo-client';

export function ApolloProvider({ children }: { children: React.ReactNode }) {
  const client = getApolloClient();
  return (
    <BaseApolloProvider client={client}>
      {children}
    </BaseApolloProvider>
  );
}
```

- [ ] **Step 3: Create Providers wrapper**

Create `prism-admin-dashboard/src/app/providers.tsx`:
```tsx
'use client';

import { ApolloProvider } from '@/lib/apollo-provider';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ApolloProvider>
      {children}
    </ApolloProvider>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/lib/apollo-client.ts src/lib/apollo-provider.tsx src/app/providers.tsx
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add Apollo Client setup with gateway connection"
```

---

### Task 5: GraphQL Queries

**Files:**
- Create: `prism-admin-dashboard/src/lib/graphql/queries/pathways.ts`

- [ ] **Step 1: Create pathway queries**

Create `prism-admin-dashboard/src/lib/graphql/queries/pathways.ts`:
```typescript
import { gql } from '@apollo/client/core';

export const GET_PATHWAYS = gql`
  query GetPathways($status: PathwayStatus, $category: PathwayCategory, $first: Int) {
    pathways(status: $status, category: $category, first: $first) {
      id
      logicalId
      title
      version
      category
      status
      conditionCodes
      scope
      targetPopulation
      isActive
      createdAt
      updatedAt
    }
  }
`;

export const GET_PATHWAY = gql`
  query GetPathway($id: ID!) {
    pathway(id: $id) {
      id
      logicalId
      title
      version
      category
      status
      conditionCodes
      scope
      targetPopulation
      isActive
      createdAt
      updatedAt
    }
  }
`;
```

- [ ] **Step 2: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/lib/graphql/queries/pathways.ts
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add GraphQL pathway queries"
```

---

### Task 6: UI Components — Button and Spinner

**Files:**
- Create: `prism-admin-dashboard/src/components/ui/Button.tsx`
- Create: `prism-admin-dashboard/src/components/ui/Spinner.tsx`

- [ ] **Step 1: Create Button component**

Create `prism-admin-dashboard/src/components/ui/Button.tsx`:
```tsx
import { forwardRef, ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, variant = 'primary', size = 'md', isLoading = false, leftIcon, className, disabled, ...props }, ref) => {
    const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]';

    const variants = {
      primary: 'bg-gradient-to-b from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/25 hover:from-blue-600 hover:to-blue-700 focus-visible:ring-blue-500 border border-blue-600',
      secondary: 'bg-gray-100 text-gray-700 shadow-sm hover:bg-gray-200 focus-visible:ring-gray-500 border border-gray-200',
      danger: 'bg-gradient-to-b from-red-500 to-red-600 text-white shadow-md shadow-red-500/25 hover:from-red-600 hover:to-red-700 focus-visible:ring-red-500 border border-red-600',
      ghost: 'bg-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:ring-gray-500',
      outline: 'bg-white text-gray-700 border border-gray-300 shadow-sm hover:bg-gray-50 hover:border-gray-400 focus-visible:ring-gray-500',
    };

    const sizes = {
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-4 py-2.5 text-sm',
      lg: 'px-5 py-3 text-base',
    };

    return (
      <button
        ref={ref}
        className={clsx(base, variants[variant], sizes[size], className)}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading ? (
          <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : leftIcon ? (
          <span className="flex-shrink-0 h-4 w-4">{leftIcon}</span>
        ) : null}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
```

- [ ] **Step 2: Create Spinner component**

Create `prism-admin-dashboard/src/components/ui/Spinner.tsx`:
```tsx
import clsx from 'clsx';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function Spinner({ size = 'md', className }: SpinnerProps) {
  const sizes = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
  };

  return (
    <svg
      className={clsx('animate-spin text-blue-500', sizes[size], className)}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/components/ui/
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add Button and Spinner UI components"
```

---

### Task 7: StatusBadge Component

**Files:**
- Create: `prism-admin-dashboard/src/components/dashboard/StatusBadge.tsx`

- [ ] **Step 1: Create StatusBadge**

Create `prism-admin-dashboard/src/components/dashboard/StatusBadge.tsx`:
```tsx
import clsx from 'clsx';
import type { PathwayStatus } from '@/types';

interface StatusBadgeProps {
  status: PathwayStatus;
}

const statusConfig: Record<PathwayStatus, { label: string; classes: string }> = {
  DRAFT: {
    label: 'Draft',
    classes: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  ACTIVE: {
    label: 'Active',
    classes: 'bg-teal-50 text-teal-700 border-teal-200',
  },
  ARCHIVED: {
    label: 'Archived',
    classes: 'bg-gray-50 text-gray-600 border-gray-200',
  },
  SUPERSEDED: {
    label: 'Superseded',
    classes: 'bg-purple-50 text-purple-700 border-purple-200',
  },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status];
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border',
        config.classes
      )}
    >
      {config.label}
    </span>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/components/dashboard/StatusBadge.tsx
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add StatusBadge component for pathway lifecycle states"
```

---

### Task 8: Sidebar Navigation

**Files:**
- Create: `prism-admin-dashboard/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Create Sidebar**

Create `prism-admin-dashboard/src/components/layout/Sidebar.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import {
  HomeIcon,
  MapIcon,
  PlusCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import {
  HomeIcon as HomeIconSolid,
  MapIcon as MapIconSolid,
  PlusCircleIcon as PlusCircleIconSolid,
} from '@heroicons/react/24/solid';
import { useState } from 'react';

const navigation = [
  {
    name: 'Pathways',
    href: '/',
    icon: HomeIcon,
    iconActive: HomeIconSolid,
    description: 'All clinical pathways',
  },
  {
    name: 'New Pathway',
    href: '/pathways/new',
    icon: PlusCircleIcon,
    iconActive: PlusCircleIconSolid,
    description: 'Upload or create',
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div
      className={clsx(
        'flex flex-col bg-gray-900 text-white transition-all duration-300 ease-out h-screen sticky top-0',
        isCollapsed ? 'w-20' : 'w-64'
      )}
    >
      {/* Logo */}
      <div className="flex items-center h-16 px-4 border-b border-gray-800">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-10 h-10 bg-gradient-to-br from-purple-400 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/30 transition-transform group-hover:scale-105">
            <span className="text-white font-bold text-xl">P</span>
          </div>
          {!isCollapsed && (
            <div className="animate-fadeIn">
              <span className="text-xl font-bold tracking-tight">Prism</span>
              <span className="text-xs text-gray-500 block -mt-0.5">Admin Dashboard</span>
            </div>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-6 space-y-1 overflow-y-auto">
        {!isCollapsed && (
          <div className="px-3 mb-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Pathway Management
            </span>
          </div>
        )}

        {navigation.map((item) => {
          const isActive = item.href === '/'
            ? pathname === '/'
            : pathname.startsWith(item.href);
          const Icon = isActive ? item.iconActive : item.icon;

          return (
            <Link
              key={item.name}
              href={item.href}
              className={clsx(
                'group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-white/10 text-white shadow-lg shadow-black/20'
                  : 'text-gray-400 hover:bg-white/5 hover:text-white',
                isCollapsed && 'justify-center px-2'
              )}
              title={isCollapsed ? item.name : undefined}
            >
              <div className={clsx(
                'flex-shrink-0 transition-transform duration-200',
                !isActive && 'group-hover:scale-110'
              )}>
                <Icon className={clsx(
                  'h-5 w-5',
                  isActive ? 'text-white' : 'text-gray-400 group-hover:text-white'
                )} />
              </div>
              {!isCollapsed && (
                <div className="flex-1 min-w-0">
                  <span className="block truncate">{item.name}</span>
                  {item.description && !isActive && (
                    <span className="block text-xs text-gray-500 truncate group-hover:text-gray-400">
                      {item.description}
                    </span>
                  )}
                </div>
              )}
              {isActive && !isCollapsed && (
                <div className="w-1.5 h-1.5 bg-purple-400 rounded-full" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Collapse Button */}
      <div className="px-3 py-3 border-t border-gray-800">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={clsx(
            'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
            'text-gray-400 hover:bg-white/5 hover:text-white',
            isCollapsed && 'justify-center px-2'
          )}
        >
          {isCollapsed ? (
            <ChevronRightIcon className="h-5 w-5" />
          ) : (
            <>
              <ChevronLeftIcon className="h-5 w-5" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
```

Note: Uses purple accent instead of blue to visually distinguish admin from provider portal.

- [ ] **Step 2: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/components/layout/Sidebar.tsx
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add admin sidebar navigation with purple accent"
```

---

### Task 9: Root Layout

**Files:**
- Create: `prism-admin-dashboard/src/app/layout.tsx`

- [ ] **Step 1: Create root layout**

Create `prism-admin-dashboard/src/app/layout.tsx`:
```tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { Sidebar } from '@/components/layout/Sidebar';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Prism Admin Dashboard',
  description: 'Clinical pathway management and administration',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased`}>
        <Providers>
          <div className="flex min-h-screen bg-gray-50">
            <Sidebar />
            <main className="flex-1 overflow-auto">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/app/layout.tsx
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add root layout with sidebar and providers"
```

---

### Task 10: PathwayTable Component

**Files:**
- Create: `prism-admin-dashboard/src/components/dashboard/PathwayTable.tsx`

- [ ] **Step 1: Create PathwayTable**

Create `prism-admin-dashboard/src/components/dashboard/PathwayTable.tsx`:
```tsx
'use client';

import Link from 'next/link';
import clsx from 'clsx';
import { ChevronUpIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { useState, useMemo } from 'react';
import { StatusBadge } from './StatusBadge';
import type { Pathway, PathwayStatus } from '@/types';

interface PathwayTableProps {
  pathways: Pathway[];
  isLoading: boolean;
}

type SortField = 'title' | 'status' | 'category' | 'version' | 'updatedAt';
type SortDirection = 'asc' | 'desc';

const categoryLabels: Record<string, string> = {
  CHRONIC_DISEASE: 'Chronic Disease',
  ACUTE_CARE: 'Acute Care',
  PREVENTIVE_CARE: 'Preventive Care',
  POST_PROCEDURE: 'Post-Procedure',
  MEDICATION_MANAGEMENT: 'Medication Mgmt',
  LIFESTYLE_MODIFICATION: 'Lifestyle',
  MENTAL_HEALTH: 'Mental Health',
  PEDIATRIC: 'Pediatric',
  GERIATRIC: 'Geriatric',
  OBSTETRIC: 'Obstetric',
};

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function PathwayTable({ pathways, isLoading }: PathwayTableProps) {
  const [sortField, setSortField] = useState<SortField>('updatedAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [statusFilter, setStatusFilter] = useState<PathwayStatus | 'ALL'>('ALL');

  const filtered = useMemo(() => {
    let result = pathways;
    if (statusFilter !== 'ALL') {
      result = result.filter(p => p.status === statusFilter);
    }
    return result;
  }, [pathways, statusFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'title': cmp = a.title.localeCompare(b.title); break;
        case 'status': cmp = a.status.localeCompare(b.status); break;
        case 'category': cmp = a.category.localeCompare(b.category); break;
        case 'version': cmp = a.version.localeCompare(b.version); break;
        case 'updatedAt': cmp = a.updatedAt.localeCompare(b.updatedAt); break;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDirection]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  }

  function SortHeader({ field, children }: { field: SortField; children: React.ReactNode }) {
    const isActive = sortField === field;
    return (
      <th
        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 select-none"
        onClick={() => toggleSort(field)}
      >
        <span className="inline-flex items-center gap-1">
          {children}
          {isActive && (
            sortDirection === 'asc'
              ? <ChevronUpIcon className="h-3 w-3" />
              : <ChevronDownIcon className="h-3 w-3" />
          )}
        </span>
      </th>
    );
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-12">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <svg className="animate-spin h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="text-sm">Loading pathways...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      {/* Filter bar */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
        <span className="text-sm text-gray-500">Status:</span>
        {(['ALL', 'DRAFT', 'ACTIVE', 'ARCHIVED', 'SUPERSEDED'] as const).map(status => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={clsx(
              'px-3 py-1 rounded-lg text-sm font-medium transition-colors',
              statusFilter === status
                ? 'bg-gray-900 text-white'
                : 'text-gray-500 hover:bg-gray-100'
            )}
          >
            {status === 'ALL' ? 'All' : status.charAt(0) + status.slice(1).toLowerCase()}
          </button>
        ))}
        <span className="ml-auto text-sm text-gray-400">
          {sorted.length} pathway{sorted.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <SortHeader field="title">Title</SortHeader>
              <SortHeader field="status">Status</SortHeader>
              <SortHeader field="category">Category</SortHeader>
              <SortHeader field="version">Version</SortHeader>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Conditions
              </th>
              <SortHeader field="updatedAt">Updated</SortHeader>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-gray-400 text-sm">
                  No pathways found. Upload a pathway JSON to get started.
                </td>
              </tr>
            ) : (
              sorted.map(pathway => (
                <tr key={pathway.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <Link
                      href={`/pathways/${pathway.id}`}
                      className="text-sm font-medium text-gray-900 hover:text-blue-600 transition-colors"
                    >
                      {pathway.title}
                    </Link>
                    <div className="text-xs text-gray-400 mt-0.5">{pathway.logicalId}</div>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={pathway.status} />
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {categoryLabels[pathway.category] || pathway.category}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 font-mono">
                    v{pathway.version}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {pathway.conditionCodes.slice(0, 3).map(code => (
                        <span
                          key={code}
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-gray-100 text-gray-600"
                        >
                          {code}
                        </span>
                      ))}
                      {pathway.conditionCodes.length > 3 && (
                        <span className="text-xs text-gray-400">
                          +{pathway.conditionCodes.length - 3}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {formatDate(pathway.updatedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/components/dashboard/PathwayTable.tsx
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add PathwayTable with sorting and status filtering"
```

---

### Task 11: Dashboard Page

**Files:**
- Create: `prism-admin-dashboard/src/app/page.tsx`

- [ ] **Step 1: Create the dashboard page**

Create `prism-admin-dashboard/src/app/page.tsx`:
```tsx
'use client';

import { useQuery } from '@apollo/client/react';
import { GET_PATHWAYS } from '@/lib/graphql/queries/pathways';
import { PathwayTable } from '@/components/dashboard/PathwayTable';
import { Button } from '@/components/ui/Button';
import { PlusIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import type { Pathway } from '@/types';

export default function DashboardPage() {
  const { data, loading, error } = useQuery<{ pathways: Pathway[] }>(GET_PATHWAYS, {
    variables: { first: 100 },
  });

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clinical Pathways</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage pathway recommendation trees for clinical decision support
          </p>
        </div>
        <Link href="/pathways/new">
          <Button leftIcon={<PlusIcon className="h-4 w-4" />}>
            New Pathway
          </Button>
        </Link>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
          <p className="text-sm text-red-700">
            Failed to load pathways. Make sure the gateway is running on port 4000.
          </p>
          <p className="text-xs text-red-500 mt-1">{error.message}</p>
        </div>
      )}

      {/* Pathway table */}
      <PathwayTable pathways={data?.pathways ?? []} isLoading={loading} />
    </div>
  );
}
```

- [ ] **Step 2: Verify the app builds**

Run:
```bash
npm --prefix /home/claude/workspace/prism-admin-dashboard run build
```

Expected: Build succeeds with no errors. There may be minor warnings which are acceptable.

- [ ] **Step 3: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/app/page.tsx
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add dashboard page with pathway listing"
```

---

### Task 12: Stub Pages for Future Routes

**Files:**
- Create: `prism-admin-dashboard/src/app/pathways/new/page.tsx`
- Create: `prism-admin-dashboard/src/app/pathways/[id]/page.tsx`
- Create: `prism-admin-dashboard/src/app/pathways/[id]/preview/page.tsx`
- Create: `prism-admin-dashboard/src/app/pathways/[logicalId]/history/page.tsx`

- [ ] **Step 1: Create new pathway stub**

Create `prism-admin-dashboard/src/app/pathways/new/page.tsx`:
```tsx
import { Button } from '@/components/ui/Button';
import { ArrowUpTrayIcon, PlusIcon } from '@heroicons/react/24/outline';

export default function NewPathwayPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">New Pathway</h1>
      <p className="text-sm text-gray-500 mb-8">
        Upload a pathway JSON file or start with a blank canvas.
      </p>

      <div className="grid grid-cols-2 gap-6 max-w-2xl">
        <div className="bg-white rounded-2xl border border-gray-200 p-8 flex flex-col items-center gap-4 text-center hover:border-blue-300 hover:shadow-md transition-all cursor-pointer">
          <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center">
            <ArrowUpTrayIcon className="h-7 w-7 text-blue-500" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">Upload JSON</h2>
          <p className="text-sm text-gray-500">
            Import a PathwayJson file generated by an LLM or exported from another pathway.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-8 flex flex-col items-center gap-4 text-center hover:border-purple-300 hover:shadow-md transition-all cursor-pointer">
          <div className="w-14 h-14 bg-purple-50 rounded-2xl flex items-center justify-center">
            <PlusIcon className="h-7 w-7 text-purple-500" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">Blank Canvas</h2>
          <p className="text-sm text-gray-500">
            Start with an empty graph editor and build the pathway visually.
          </p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create pathway editor stub**

Create `prism-admin-dashboard/src/app/pathways/[id]/page.tsx`:
```tsx
import { use } from 'react';

export default function PathwayEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Pathway Editor</h1>
      <p className="text-sm text-gray-500">
        Editing pathway <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">{id}</code>
      </p>
      <div className="mt-8 bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400">
        Graph editor — coming in Plan 2
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create preview stub**

Create `prism-admin-dashboard/src/app/pathways/[id]/preview/page.tsx`:
```tsx
import { use } from 'react';

export default function PathwayPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Pathway Preview</h1>
      <p className="text-sm text-gray-500">
        Simulating pathway <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">{id}</code>
      </p>
      <div className="mt-8 bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400">
        Preview / simulation mode — coming in Plan 5
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create history stub**

Create `prism-admin-dashboard/src/app/pathways/[logicalId]/history/page.tsx`:
```tsx
import { use } from 'react';

export default function PathwayHistoryPage({ params }: { params: Promise<{ logicalId: string }> }) {
  const { logicalId } = use(params);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Version History</h1>
      <p className="text-sm text-gray-500">
        All versions of <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">{logicalId}</code>
      </p>
      <div className="mt-8 bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400">
        Version history &amp; diffs — coming in Plan 6
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify build**

Run:
```bash
npm --prefix /home/claude/workspace/prism-admin-dashboard run build
```

Expected: Build succeeds. All routes should compile.

- [ ] **Step 6: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/app/pathways/
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add stub pages for editor, preview, and history routes"
```

---

## Plan Summary

After completing all 12 tasks, the admin dashboard will:
- Be a standalone Next.js 16 app at `workspace/prism-admin-dashboard/`
- Run on port 3001, connect to gateway on port 4000
- Display a pathway list with status badges, sorting, and filtering
- Have a sidebar with admin-specific purple accent
- Have stub pages for all future routes (editor, preview, history, new pathway)
- Build and lint cleanly

**Next plans:**
- **Plan 2:** Graph editor core (React Flow canvas, custom nodes, palette, properties panel)
- **Plan 3:** Serialization + save/publish (PathwayJson ↔ React Flow, Zod validation, import flow)
- **Plan 4:** JSON editor (Monaco, bidirectional sync)
- **Plan 5:** Preview/simulation mode (confidence scoring, mock patient context)
- **Plan 6:** Version history (diffs, fork from historical version)
- **Plan 7:** LLM pathway spec document
