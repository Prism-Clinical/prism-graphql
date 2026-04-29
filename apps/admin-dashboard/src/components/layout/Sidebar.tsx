'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import {
  HomeIcon,
  PlusCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import {
  HomeIcon as HomeIconSolid,
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

  // Hide sidebar on pathway editor pages (EditorToolbar has a back arrow)
  const isEditorPage = /^\/pathways\/(?!new)[^/]+$/.test(pathname);
  if (isEditorPage) return null;

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
