import { Home, Images, Clock3, Settings, Search, Menu } from "lucide-react";
import { ReactNode } from "react";
import { NavLink, useNavigate } from "@remix-run/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Avatar } from "~/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { ThemeToggle } from "~/components/ThemeToggle";
import { Sheet, SheetContent, SheetTrigger } from "~/components/ui/sheet";

export function AppShell({
  children,
  username,
  role,
  onLogout,
}: {
  children: ReactNode;
  username?: string;
  role?: string;
  onLogout?: () => void;
}) {
  const navigate = useNavigate();
  const initial = username ? username.charAt(0).toUpperCase() : "U";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr]">
        {/* Sidebar */}
        <aside className="hidden lg:block border-r bg-card/40">
          <div className="h-14 px-4 flex items-center border-b">
            <div className="font-semibold">MDA</div>
          </div>
          <nav className="p-3 space-y-1">
            <NavItem to="/dashboard" icon={<Home className="h-4 w-4" />}>Dashboard</NavItem>
            <NavItem to="/library" icon={<Images className="h-4 w-4" />}>Library</NavItem>
            <NavItem to="/recent" icon={<Clock3 className="h-4 w-4" />}>Recent</NavItem>
            <NavItem to="#" icon={<Settings className="h-4 w-4" />}>Settings</NavItem>
          </nav>
        </aside>

        {/* Main content */}
        <div className="flex flex-col">
          {/* Topbar */}
          <header className="h-14 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="h-full px-4 gap-3 flex items-center justify-between">
              <div className="flex items-center gap-2 lg:hidden">
                <Sheet>
                  <SheetTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Open menu">
                      <Menu className="h-5 w-5" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left">
                    <div className="font-semibold mb-4">MDA</div>
                    <nav className="space-y-1">
                      <NavItem to="/dashboard" icon={<Home className="h-4 w-4" />}>Dashboard</NavItem>
                      <NavItem to="/library" icon={<Images className="h-4 w-4" />}>Library</NavItem>
                      <NavItem to="/recent" icon={<Clock3 className="h-4 w-4" />}>Recent</NavItem>
                      <NavItem to="#" icon={<Settings className="h-4 w-4" />}>Settings</NavItem>
                    </nav>
                  </SheetContent>
                </Sheet>
                <div className="font-semibold">MDA</div>
              </div>
              <div className="flex-1 max-w-xl">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-8" placeholder="Search media..." />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ThemeToggle />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="h-9 gap-2">
                      <Avatar fallback={initial} size="sm" />
                      <div className="hidden md:flex flex-col items-start">
                        <span className="text-xs leading-tight">{username || "User"}</span>
                        <span className="text-[10px] text-muted-foreground capitalize">{role || "member"}</span>
                      </div>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>My Account</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate("/dashboard")}>Dashboard</DropdownMenuItem>
                    <DropdownMenuItem onClick={onLogout}>Logout</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </header>

          <main className="p-4">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

function NavItem({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent hover:text-accent-foreground ${
          isActive ? "bg-accent text-accent-foreground" : "text-foreground/80"
        }`
      }
    >
      {icon}
      <span>{children}</span>
    </NavLink>
  );
}
