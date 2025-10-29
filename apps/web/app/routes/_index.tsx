import { redirect } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";

export async function loader({ request }: LoaderFunctionArgs) {
  // Check if user is authenticated (you'd implement this based on your auth)
  return redirect("/dashboard");
}
