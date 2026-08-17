import { useState, useEffect } from "react";
import type { NavigateFunction } from "react-router";
import { createGraphQLClient, getAuthToken } from "~/lib/api";

const USERS_QUERY = `
  query GetUsers {
    users {
      id
      username
      role
      createdAt
    }
    me {
      id
      username
      role
    }
  }
`;

const CREATE_USER_MUTATION = `
  mutation CreateUser($username: String!, $password: String!, $role: String!) {
    createUser(username: $username, password: $password, role: $role) {
      id
      username
      role
      createdAt
    }
  }
`;

const UPDATE_USER_ROLE_MUTATION = `
  mutation UpdateUserRole($id: ID!, $role: String!) {
    updateUserRole(id: $id, role: $role) {
      id
      username
      role
    }
  }
`;

const DELETE_USER_MUTATION = `
  mutation DeleteUser($id: ID!) {
    deleteUser(id: $id)
  }
`;

const RESET_PASSWORD_MUTATION = `
  mutation ResetPassword($userId: ID!, $newPassword: String!) {
    resetPassword(userId: $userId, newPassword: $newPassword)
  }
`;

const CHANGE_MY_PASSWORD_MUTATION = `
  mutation ChangeMyPassword($currentPassword: String!, $newPassword: String!) {
    changeMyPassword(currentPassword: $currentPassword, newPassword: $newPassword)
  }
`;

export interface UserData {
  id: string;
  username: string;
  role: string;
  createdAt: string;
}

/**
 * Owns user list/loading state, the create/edit/delete/reset-password/
 * change-my-password dialog+form state, and the mutations that back them,
 * for the users admin page. `navigate` is injected so the hook can redirect
 * to /login (no token) or /dashboard (non-admin) exactly as the original
 * page did inline.
 */
export function useUsers(navigate: NavigateFunction) {
  const [users, setUsers] = useState<UserData[]>([]);
  const [currentUser, setCurrentUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showResetPasswordDialog, setShowResetPasswordDialog] = useState(false);
  const [showChangeMyPasswordDialog, setShowChangeMyPasswordDialog] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; userId: string }>({ open: false, userId: "" });
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const [formData, setFormData] = useState({ username: "", password: "", role: "readonly" });
  const [newPassword, setNewPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const token = getAuthToken();
    if (!token) { navigate("/login"); return; }
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      const data: any = await client.request(USERS_QUERY);
      setUsers(data.users);
      setCurrentUser(data.me);
      if (data.me.role !== "admin") navigate("/dashboard");
    } catch {
      setError("Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      await client.request(CREATE_USER_MUTATION, formData);
      setShowCreateDialog(false);
      setFormData({ username: "", password: "", role: "readonly" });
      loadUsers();
    } catch (err: any) {
      setError(err.message || "Failed to create user");
    }
  };

  const handleUpdateRole = async (userId: string, newRole: string) => {
    try {
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      await client.request(UPDATE_USER_ROLE_MUTATION, { id: userId, role: newRole });
      setShowEditDialog(false);
      setSelectedUser(null);
      loadUsers();
    } catch (err: any) {
      setError(err.message || "Failed to update user role");
    }
  };

  const handleDeleteUser = (userId: string) => {
    setDeleteConfirm({ open: true, userId });
  };

  const confirmDeleteUser = async () => {
    const token = getAuthToken();
    if (!token) return;
    const client = createGraphQLClient(token);
    await client.request(DELETE_USER_MUTATION, { id: deleteConfirm.userId });
    loadUsers();
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!selectedUser) return;
    try {
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      await client.request(RESET_PASSWORD_MUTATION, { userId: selectedUser.id, newPassword });
      setShowResetPasswordDialog(false);
      setSelectedUser(null);
      setNewPassword("");
      alert("Password reset successfully");
    } catch (err: any) {
      setError(err.message || "Failed to reset password");
    }
  };

  const handleChangeMyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) { setError("New passwords do not match"); return; }
    if (newPassword.length < 6) { setError("Password must be at least 6 characters long"); return; }
    try {
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      await client.request(CHANGE_MY_PASSWORD_MUTATION, { currentPassword, newPassword });
      setShowChangeMyPasswordDialog(false);
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setError("");
      alert("Password changed successfully");
    } catch (err: any) {
      setError(err.message || "Failed to change password");
    }
  };

  return {
    users, currentUser, loading, error, setError,
    showCreateDialog, setShowCreateDialog,
    showEditDialog, setShowEditDialog,
    showResetPasswordDialog, setShowResetPasswordDialog,
    showChangeMyPasswordDialog, setShowChangeMyPasswordDialog,
    deleteConfirm, setDeleteConfirm,
    selectedUser, setSelectedUser,
    formData, setFormData,
    newPassword, setNewPassword,
    currentPassword, setCurrentPassword,
    confirmPassword, setConfirmPassword,
    loadUsers,
    handleCreateUser,
    handleUpdateRole,
    handleDeleteUser,
    confirmDeleteUser,
    handleResetPassword,
    handleChangeMyPassword,
  };
}
