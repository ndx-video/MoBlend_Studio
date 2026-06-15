import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Home, FolderOpen, Image, Play, Upload, Settings, Wrench } from 'lucide-react';
import StatusBar from './StatusBar';

const nav = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/projects', label: 'Projects', icon: FolderOpen },
  { to: '/assets', label: 'Assets', icon: Image },
  { to: '/editor', label: 'Editor', icon: Play },
  { to: '/export', label: 'Export', icon: Upload },
  { to: '/settings/suite', label: 'Suite', icon: Wrench },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function AppShell() {
  return (
    <div className="flex h-full flex-col bg-surface text-on-surface font-sans text-sm">
      <div className="flex flex-1 min-h-0">
        <nav className="w-[72px] bg-surface-container-low border-r border-outline-variant flex flex-col items-center pt-4 gap-2 flex-shrink-0" aria-label="Primary" data-testid="nav-rail">
          {nav.map(item => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `w-12 h-12 flex items-center justify-center rounded text-on-surface-variant transition-colors ${isActive ? 'bg-primary/10 text-primary' : 'hover:bg-surface-container-high'}`}
                title={item.label}
                data-testid={`nav-${item.label.toLowerCase()}`}
              >
                <Icon size={20} />
              </NavLink>
            );
          })}
        </nav>
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="h-9 bg-surface-container-low border-b border-outline-variant flex items-center px-3 text-xs text-on-surface-variant" data-testid="app-header">
            Mo.Blend Studio
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-3">
            <Outlet />
          </div>
        </div>
      </div>
      <StatusBar />
    </div>
  );
}