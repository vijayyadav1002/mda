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
    tags: [Tag!]!
  }

  type Tag {
    id: ID!
    name: String!
    createdAt: String!
    assetCount: Int!
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
    size: Float
  }

  type SearchFolderResult {
    name: String!
    path: String!
    parentPath: String
  }

  type SearchResults {
    files: [MediaAsset!]!
    folders: [SearchFolderResult!]!
  }

  type Query {
    me: User
    users: [User!]!
    mediaAssets(limit: Int, offset: Int, mimeType: String): [MediaAsset!]!
    mediaAsset(id: ID!): MediaAsset
    directoryTree: DirectoryNode!
    directoryNode(path: String): DirectoryNode!
    auditLogs(limit: Int, offset: Int, userId: ID, action: String, resourceType: String, startDate: String, endDate: String): [AuditLog!]!
    auditLogsCount(userId: ID, action: String, resourceType: String, startDate: String, endDate: String): Int!
    hasAdminUser: Boolean!
    tags: [Tag!]!
    mediaAssetsByTag(tagName: String!, limit: Int, offset: Int): [MediaAsset!]!
    cacheStats: CacheStats!
    search(term: String, mediaType: String, sortBy: String, limit: Int, minSize: Float, maxSize: Float, path: String): SearchResults!
  }

  type Mutation {
    login(username: String!, password: String!): AuthPayload!
    createFirstAdmin(username: String!, password: String!): AuthPayload!
    createUser(username: String!, password: String!, role: String!): User!
    updateUserRole(id: ID!, role: String!): User!
    deleteUser(id: ID!): Boolean!
    resetPassword(userId: ID!, newPassword: String!): Boolean!
    changeMyPassword(currentPassword: String!, newPassword: String!): Boolean!
    
    moveMediaAsset(id: ID!, newPath: String!): MediaAsset!
    renameMediaAsset(id: ID!, newName: String!): MediaAsset!
    duplicateMediaAsset(id: ID!, destinationFolder: String): MediaAsset!
    deleteMediaAsset(id: ID!): Boolean!
    compressMediaAsset(id: ID!, quality: Int, overwrite: Boolean): MediaAsset!
    refreshMediaLibrary: String!
    generateThumbnailsForPath(path: String): Int!
    generateThumbnailsForAssets(ids: [ID!]!, sessionId: String): Int!
    cancelThumbnailJobsForSession(sessionId: String!): Int!
    previewCompressAssets(ids: [ID!]!, options: CompressOptionsInput!): [CompressPreviewResult!]!
    confirmCompressReplace(ids: [ID!]!): [MediaAsset!]!
    cancelCompressPreview(ids: [ID!]!): Boolean!

    createFolder(parentPath: String, name: String!): DirectoryNode!
    deleteFolder(path: String!): Boolean!
    renameFolder(path: String!, newName: String!): DirectoryNode!
    moveFolder(path: String!, destinationFolder: String!): DirectoryNode!
    duplicateFolder(path: String!, destinationFolder: String): DirectoryNode!

    applyTagsToAssets(assetIds: [ID!]!, tagNames: [String!]!): [MediaAsset!]!
    removeTagFromAsset(assetId: ID!, tagName: String!): MediaAsset!
    renameTag(oldName: String!, newName: String!): Tag!
    deleteTag(name: String!): Boolean!
    clearCache(type: String!): CacheStats!
  }

  input CompressOptionsInput {
    resolution: String
    quality: Int
  }

  type CompressPreviewResult {
    assetId: ID!
    originalSize: String!
    compressedSize: String!
    previewUrl: String!
  }

  type CacheTypeStats {
    label: String!
    bytes: Float!
    fileCount: Int!
    maxBytes: Float!
  }

  type CacheStats {
    thumbnails: CacheTypeStats!
    previews: CacheTypeStats!
    hls: CacheTypeStats!
    transcoded: CacheTypeStats!
    totalBytes: Float!
  }
`;
