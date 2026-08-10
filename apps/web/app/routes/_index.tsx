import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  // Check if user is authenticated (you'd implement this based on your auth)
  return redirect("/dashboard");
}
