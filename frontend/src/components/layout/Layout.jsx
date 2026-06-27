import React from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { Home, Settings, LogOut, Box, Package } from "lucide-react";
import { useAuth } from "../../store/auth";
import clsx from "clsx";

const nav = [
  { to: "/",          icon: Home,     label: "Accueil"    },
  { to: "/filaments", icon: Package,  label: "Filaments"  },
  { to: "/settings",  icon: Settings, label: "Paramètres" },
];

export default function Layout() {
  const { logout } = useAuth();
  const navigate   = useNavigate();

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-[#0f1117]">
      {/* Sidebar desktop */}
      <aside className="hidden md:flex flex-col w-16 lg:w-52 sidebar py-5 shrink-0">
        <div className="flex items-center gap-2.5 px-4 mb-8">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center shrink-0">
            <Box size={14} className="text-white" />
          </div>
          <span className="hidden lg:block font-bold text-sm tracking-tight bg-gradient-to-r from-blue-500 to-cyan-400 bg-clip-text text-transparent">
            BambuNymous
          </span>
        </div>

        <nav className="flex-1 space-y-0.5 px-2">
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) =>
              clsx("flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all",
                isActive
                  ? "bg-blue-500/15 text-blue-600 dark:text-blue-400 font-medium"
                  : "text-gray-500 dark:text-gray-500 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-200/60 dark:hover:bg-white/[0.04]"
              )
            }>
              <Icon size={17} className="shrink-0" />
              <span className="hidden lg:block">{label}</span>
            </NavLink>
          ))}
        </nav>

        <button onClick={() => { logout(); navigate("/login"); }}
          className="flex items-center gap-3 mx-2 px-3 py-2.5 rounded-xl text-gray-400 hover:text-red-500 hover:bg-gray-200/60 dark:hover:bg-white/[0.04] text-sm transition-all">
          <LogOut size={17} className="shrink-0" />
          <span className="hidden lg:block">Déconnexion</span>
        </button>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header mobile */}
        <header className="md:hidden flex items-center gap-2 px-4 py-3 sidebar border-b">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
            <Box size={12} className="text-white" />
          </div>
          <span className="font-bold text-sm bg-gradient-to-r from-blue-500 to-cyan-400 bg-clip-text text-transparent">
            BambuNymous
          </span>
        </header>

        <main className="flex-1 overflow-y-auto p-4 bg-gray-50 dark:bg-[#0f1117]">
          <Outlet />
        </main>

        {/* Bottom nav mobile */}
        <nav className="md:hidden flex sidebar border-t">
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) =>
              clsx("flex-1 flex flex-col items-center py-3 gap-0.5 text-[11px] transition-colors",
                isActive ? "text-blue-500" : "text-gray-400 dark:text-gray-600"
              )
            }>
              <Icon size={19} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
