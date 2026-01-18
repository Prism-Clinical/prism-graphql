'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import {
  HomeIcon,
  DocumentDuplicateIcon,
  ShieldExclamationIcon,
  UsersIcon,
  BeakerIcon,
  ArrowDownTrayIcon,
  ClipboardDocumentListIcon,
  Cog6ToothIcon,
  UserGroupIcon,
  ArrowRightOnRectangleIcon,
  AcademicCapIcon,
  Square3Stack3DIcon,
  MapIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '@/contexts/AuthContext';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: HomeIcon },
  { name: 'Provider Approvals', href: '/provider-approvals', icon: UserGroupIcon },
  { name: 'Care Plans', href: '/care-plans', icon: DocumentDuplicateIcon },
  { name: 'Training Examples', href: '/training-examples', icon: AcademicCapIcon },
  { name: 'ML Models', href: '/ml-models', icon: Square3Stack3DIcon },
  { name: 'Recommendation Engine', href: '/recommendation-engine', icon: SparklesIcon },
  { name: 'Decision Explorer', href: '/decision-explorer', icon: MapIcon },
  { name: 'Clinical Alerts', href: '/safety-rules', icon: ShieldExclamationIcon },
  { name: 'Users', href: '/users', icon: UsersIcon },
  { name: 'Medications', href: '/medications', icon: BeakerIcon },
  { name: 'Import/Export', href: '/import-export', icon: ArrowDownTrayIcon },
  { name: 'Audit Logs', href: '/audit-logs', icon: ClipboardDocumentListIcon },
];

const secondaryNavigation = [
  { name: 'Settings', href: '/settings', icon: Cog6ToothIcon },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <div className="flex flex-col h-full bg-indigo-900 w-64">
      {/* Logo */}
      <div className="flex items-center h-16 px-6 border-b border-indigo-800">
        <div className="flex items-center">
          <Cog6ToothIcon className="h-8 w-8 text-indigo-300" />
          <div className="ml-2">
            <span className="text-xl font-bold text-white">Prism</span>
            <span className="ml-1 text-xs font-medium text-indigo-300 bg-indigo-800 px-2 py-0.5 rounded">Admin</span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
        {navigation.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.name}
              href={item.href}
              className={clsx(
                'flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors',
                isActive
                  ? 'bg-indigo-800 text-white'
                  : 'text-indigo-200 hover:bg-indigo-800 hover:text-white'
              )}
            >
              <item.icon
                className={clsx(
                  'mr-3 h-5 w-5',
                  isActive ? 'text-indigo-300' : 'text-indigo-400'
                )}
              />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* Secondary Navigation */}
      <div className="px-4 py-4 border-t border-indigo-800">
        {secondaryNavigation.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={clsx(
                'flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors',
                isActive
                  ? 'bg-indigo-800 text-white'
                  : 'text-indigo-200 hover:bg-indigo-800 hover:text-white'
              )}
            >
              <item.icon
                className={clsx(
                  'mr-3 h-5 w-5',
                  isActive ? 'text-indigo-300' : 'text-indigo-400'
                )}
              />
              {item.name}
            </Link>
          );
        })}
      </div>

      {/* User Info */}
      <div className="px-4 py-4 border-t border-indigo-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className="h-8 w-8 rounded-full bg-indigo-700 flex items-center justify-center">
              <span className="text-sm font-medium text-white">
                {user?.firstName?.charAt(0) || 'A'}
              </span>
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-white">
                {user ? `${user.firstName} ${user.lastName}` : 'Admin User'}
              </p>
              <p className="text-xs text-indigo-300">{user?.roles?.[0] || 'Administrator'}</p>
            </div>
          </div>
          <button
            onClick={() => logout()}
            className="p-2 text-indigo-300 hover:text-white hover:bg-indigo-800 rounded-md transition-colors"
            title="Logout"
          >
            <ArrowRightOnRectangleIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
