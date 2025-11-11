import * as React from "react";
import { cn } from "~/lib/utils";

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string;
  alt?: string;
  fallback?: string;
  size?: "sm" | "md" | "lg";
}

export const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  ({ src, alt, fallback, size = "md", className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "relative inline-flex items-center justify-center overflow-hidden rounded-full bg-muted text-foreground/80",
          size === "sm" && "h-8 w-8 text-xs",
          size === "md" && "h-9 w-9 text-sm",
          size === "lg" && "h-10 w-10 text-base",
          className
        )}
        {...props}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={alt} className="h-full w-full object-cover" />
        ) : (
          <span className="font-medium">{fallback}</span>
        )}
      </div>
    );
  }
);
Avatar.displayName = "Avatar";