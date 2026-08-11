import { useState } from "react";
import { createGraphQLClient, getAuthToken } from "~/lib/api";

const CHANGE_MY_PASSWORD_MUTATION = `
  mutation ChangeMyPassword($currentPassword: String!, $newPassword: String!) {
    changeMyPassword(currentPassword: $currentPassword, newPassword: $newPassword)
  }
`;

/**
 * Owns the "change my own password" dialog: its open state, form fields,
 * error state, and the submit handler that calls the ChangeMyPassword
 * mutation.
 */
export function usePasswordChange() {
  const [showChangePasswordDialog, setShowChangePasswordDialog] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError("Password must be at least 6 characters long");
      return;
    }
    try {
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      await client.request(CHANGE_MY_PASSWORD_MUTATION, { currentPassword, newPassword });
      setShowChangePasswordDialog(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordError("");
      alert("Password changed successfully");
    } catch (err: any) {
      setPasswordError(err.message || "Failed to change password");
    }
  };

  return {
    showChangePasswordDialog,
    setShowChangePasswordDialog,
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    passwordError,
    setPasswordError,
    handleChangePassword,
  };
}
