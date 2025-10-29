import { useState } from "react";
import { useNavigate } from "@remix-run/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
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

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isFirstTime, setIsFirstTime] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            {isFirstTime ? "Create Admin Account" : "Login"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Username</label>
              <Input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <div className="text-sm text-destructive">{error}</div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Loading..." : isFirstTime ? "Create Admin" : "Login"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => setIsFirstTime(!isFirstTime)}
            >
              {isFirstTime ? "Back to Login" : "First Time Setup"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
