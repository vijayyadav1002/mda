export const authSdl = `
  type User {
    id: ID!
    username: String!
    role: String!
    createdAt: String!
  }

  type AuthPayload {
    token: String!
    user: User!
  }
`;
