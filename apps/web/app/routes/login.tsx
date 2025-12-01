import { useState, useEffect } from "react";
import { useNavigate } from "@remix-run/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { createGraphQLClient, setAuthToken } from "~/lib/api";
import { Moon, Sun } from "lucide-react";

const LOGIN_MUTATION = `
  mutation Login($username: String!, $password: String!) {
    login(username: $username, password: $password) {
      token
      user {
        id
        username
        role
      }
    }
  }
`;

const CREATE_FIRST_ADMIN_MUTATION = `
  mutation CreateFirstAdmin($username: String!, $password: String!) {
    createFirstAdmin(username: $username, password: $password) {
      token
      user {
        id
        username
        role
      }
    }
  }
`;

const HAS_ADMIN_QUERY = `
  query HasAdminUser {
    hasAdminUser
  }
`;

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isFirstTime, setIsFirstTime] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasAdmin, setHasAdmin] = useState(true); // Default to true to hide the button initially
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("darkMode");
      if (stored) return stored === "true";
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return false;
  });
  const navigate = useNavigate();

  // Check if admin user exists on component mount
  useEffect(() => {
    const checkAdminExists = async () => {
      try {
        const client = createGraphQLClient();
        const data: any = await client.request(HAS_ADMIN_QUERY);
        setHasAdmin(data.hasAdminUser);
      } catch (err) {
        console.error("Failed to check admin status:", err);
        // On error, assume admin exists to prevent unauthorized access
        setHasAdmin(true);
      }
    };
    
    checkAdminExists();
  }, []);

  const toggleDarkMode = () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    if (typeof window !== "undefined") {
      localStorage.setItem("darkMode", String(newMode));
      if (newMode) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const client = createGraphQLClient();
      const mutation = isFirstTime ? CREATE_FIRST_ADMIN_MUTATION : LOGIN_MUTATION;
      const data: any = await client.request(mutation, { username, password });
      
      const result = isFirstTime ? data.createFirstAdmin : data.login;
      setAuthToken(result.token);
      navigate("/dashboard");
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-blue-50/30 to-purple-50/30 dark:from-gray-900 dark:via-gray-900 dark:to-gray-900 p-4 transition-colors duration-200">
      {/* Dark mode toggle */}
      <button
        onClick={toggleDarkMode}
        className="fixed top-6 right-6 p-3 rounded-full bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border border-gray-200 dark:border-gray-700 shadow-lg hover:shadow-xl transition-all duration-200 z-50"
        aria-label="Toggle dark mode"
      >
        {darkMode ? (
          <Sun className="w-5 h-5 text-yellow-500" />
        ) : (
          <Moon className="w-5 h-5 text-gray-700" />
        )}
      </button>

      <Card className="w-full max-w-md bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border-gray-200 dark:border-gray-700 shadow-xl">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-400 dark:to-purple-400 bg-clip-text text-transparent">
            {isFirstTime ? "Create Admin Account" : "Media Dashboard"}
          </CardTitle>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {isFirstTime ? "Set up your administrator account" : "Sign in to access your media library"}
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="text-sm font-medium mb-1 block text-gray-700 dark:text-gray-300">
                Username
              </label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="dark:bg-gray-900/50 dark:border-gray-600 dark:text-white dark:placeholder-gray-500"
                placeholder="Enter your username"
              />
            </div>
            <div>
              <label htmlFor="password" className="text-sm font-medium mb-1 block text-gray-700 dark:text-gray-300">
                Password
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="dark:bg-gray-900/50 dark:border-gray-600 dark:text-white dark:placeholder-gray-500"
                placeholder="Enter your password"
              />
            </div>
            {error && (
              <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3">
                {error}
              </div>
            )}
            <Button 
              type="submit" 
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 dark:from-blue-500 dark:to-purple-500 dark:hover:from-blue-600 dark:hover:to-purple-600 text-white shadow-md hover:shadow-lg transition-all duration-200" 
              disabled={loading}
            >
              {(() => {
                if (loading) return "Loading...";
                if (isFirstTime) return "Create Admin";
                return "Login";
              })()}
            </Button>
            {!hasAdmin && (
              <Button
                type="button"
                variant="ghost"
                className="w-full text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700/50"
                onClick={() => setIsFirstTime(!isFirstTime)}
              >
                {isFirstTime ? "Back to Login" : "First Time Setup"}
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
