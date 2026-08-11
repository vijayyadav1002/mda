interface SidebarNavItemProps {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  onClick?: () => void;
  badge?: number;
}

export function SidebarNavItem({
  icon: Icon,
  label,
  active,
  onClick,
  badge,
}: SidebarNavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 relative ${
        active
          ? "nav-active bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {label}
      {badge != null && badge > 0 && (
        <span className="ml-auto w-5 h-5 gradient-brand rounded-full flex items-center justify-center text-[10px] font-bold text-[#060e20]">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </button>
  );
}
