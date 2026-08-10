import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),
  route("login", "routes/login.tsx"),
  route("dashboard", "routes/dashboard.tsx"),
  route("timeline", "routes/timeline.tsx"),
  route("trash", "routes/trash.tsx"),
  route("audit", "routes/audit.tsx"),
  route("users", "routes/users.tsx"),
] satisfies RouteConfig;
