import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { createGraphQLClient, setAuthToken } from "~/lib/api";

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
  const [hasAdmin, setHasAdmin] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // Force dark mode on login page
    document.documentElement.classList.add("dark");

    const checkAdminExists = async () => {
      try {
        const client = createGraphQLClient();
        const data: any = await client.request(HAS_ADMIN_QUERY);
        setHasAdmin(data.hasAdminUser);
      } catch {
        setHasAdmin(true);
      }
    };
    checkAdminExists();
  }, []);

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
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden bg-[#060e20]">
      {/* Background gradient orbs */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/3 w-96 h-96 rounded-full bg-brand-primary/10 blur-3xl" />
        <div className="absolute bottom-1/4 right-1/3 w-80 h-80 rounded-full bg-brand-secondary/10 blur-3xl" />
      </div>

      {/* Card */}
      <div className="relative z-10 w-full max-w-sm mx-auto px-4">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl gradient-brand flex items-center justify-center shadow-ambient mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            </svg>
          </div>
          <h1 className="font-manrope text-2xl font-bold text-on-surface tracking-tight">
            {isFirstTime ? "The Curator" : "The Curator"}
          </h1>
          <p className="label-meta mt-1">Media Archive Management</p>
        </div>

        {/* Glass card */}
        <div className="glass rounded-2xl p-8 shadow-ambient border border-white/5">
          <h2 className="font-manrope text-xl font-bold text-on-surface mb-1">
            {isFirstTime ? "Create Account" : "Welcome Back"}
          </h2>
          <p className="text-on-surface-variant text-sm mb-6">
            {isFirstTime
              ? "Set up your administrator account to begin."
              : "Please enter your credentials to access the vault."}
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label htmlFor="username" className="label-meta">
                Identifier
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                placeholder="Username or email"
                className="w-full px-4 py-3 rounded-xl bg-surface-low border border-outline-variant/20 text-on-surface placeholder:text-on-surface-variant/40 text-sm outline-hidden transition-all duration-200 focus:border-brand-primary/80 focus:ring-2 focus:ring-brand-primary/20"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="label-meta">
                  Passphrase
                </label>
              </div>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="w-full px-4 py-3 rounded-xl bg-surface-low border border-outline-variant/20 text-on-surface placeholder:text-on-surface-variant/40 text-sm outline-hidden transition-all duration-200 focus:border-brand-primary/80 focus:ring-2 focus:ring-brand-primary/20"
              />
            </div>

            {error && (
              <div className="text-sm text-brand-tertiary bg-brand-tertiary/10 rounded-xl p-3">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm tracking-wide shadow-ambient hover:opacity-90 transition-opacity duration-200 disabled:opacity-50 mt-2"
            >
              {loading ? "Authenticating…" : isFirstTime ? "Create Account" : "Authenticate"}
            </button>

            {!hasAdmin && (
              <button
                type="button"
                onClick={() => setIsFirstTime(!isFirstTime)}
                className="w-full py-2 text-on-surface-variant text-sm hover:text-on-surface transition-colors duration-200"
              >
                {isFirstTime ? "Back to Login" : (
                  <>New archivist? <span className="text-brand-primary font-medium">Request Access</span></>
                )}
              </button>
            )}
          </form>
        </div>

        {/* Status footer */}
        <div className="flex items-center justify-center gap-2 mt-6">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="label-meta">System Operational</span>
        </div>
      </div>
    </div>
  );
}
