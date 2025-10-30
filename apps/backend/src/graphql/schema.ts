export const schema = `
  type User {
    id: ID!
    username: String!
    role: String!
    createdAt: String!
  }

  type MediaAsset {
    id: ID!
    filePath: String!
    fileName: String!
    fileSize: String!
    mimeType: String!
    width: Int
    height: Int
    duration: Float
    thumbnailPath: String
    thumbnailUrl: String
    transcodedPath: String
    transcodedUrl: String
    indexedAt: String!
    createdAt: String!
    updatedAt: String!
  }

  type AuditLog {
    id: ID!
    userId: ID!
    user: User
    action: String!
    resourceType: String!
    resourceId: ID
    details: String
    createdAt: String!
  }

  type AuthPayload {
    token: String!
    user: User!
  }

  type DirectoryNode {
    name: String!
    path: String!
    type: String!
    children: [DirectoryNode!]
    mediaAsset: MediaAsset
  }

  type DeleteMediaAssetResponse {
    success: Boolean!
    message: String
  }

  type Query {
    me: User
    users: [User!]!
    mediaAssets(limit: Int, offset: Int, mimeType: String): [MediaAsset!]!
    mediaAsset(id: ID!): MediaAsset
    directoryTree: DirectoryNode!
    auditLogs(limit: Int, offset: Int): [AuditLog!]!
  }

  type Mutation {
    login(username: String!, password: String!): AuthPayload!
    createFirstAdmin(username: String!, password: String!): AuthPayload!
    createUser(username: String!, password: String!, role: String!): User!
    deleteUser(id: ID!): Boolean!
    moveMediaAsset(id: ID!, newPath: String!): MediaAsset!
    renameMediaAsset(id: ID!, newName: String!): MediaAsset!
    deleteMediaAsset(id: ID!): DeleteMediaAssetResponse!
    compressMediaAsset(id: ID!, quality: Int, overwrite: Boolean): MediaAsset!
  }
`;
