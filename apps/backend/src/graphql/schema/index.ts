import { authSdl } from './auth.sdl.js';
import { mediaSdl } from './media.sdl.js';
import { directorySdl } from './directory.sdl.js';
import { tagsSdl } from './tags.sdl.js';
import { compressSdl } from './compress.sdl.js';
import { cacheAuditSdl } from './cache-audit.sdl.js';
import { timelineSdl } from './timeline.sdl.js';
import { trashSdl } from './trash.sdl.js';

const rootSdl = `
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
    timelineBuckets(granularity: String!, coverLimit: Int): [TimelineBucket!]!
    timelineAssets(from: String!, to: String!, limit: Int, offset: Int): TimelineAssetsResult!
    cacheSettings: CacheSettings!
    timelineSettings: TimelineSettings!
    trashItems: [TrashItem!]!
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
    generateThumbnailsForAssets(ids: [ID!]!, sessionId: String, force: Boolean): Int!
    cancelThumbnailJobsForSession(sessionId: String!): Int!
    previewCompressAssets(ids: [ID!]!, options: CompressOptionsInput!): [CompressPreviewResult!]!
    confirmCompressReplace(ids: [ID!]!): [MediaAsset!]!
    cancelCompressPreview(ids: [ID!]!): Boolean!

    createTextFile(parentPath: String, name: String!): MediaAsset!
    createFolder(parentPath: String, name: String!): DirectoryNode!
    deleteFolder(path: String!): Boolean!
    renameFolder(path: String!, newName: String!): DirectoryNode!
    moveFolder(path: String!, destinationFolder: String!): DirectoryNode!
    duplicateFolder(path: String!, destinationFolder: String): DirectoryNode!

    applyTagsToAssets(assetIds: [ID!]!, tagNames: [String!]!): [MediaAsset!]!
    removeTagFromAsset(assetId: ID!, tagName: String!): MediaAsset!
    removeTagsFromAssets(assetIds: [ID!]!, tagNames: [String!]!): Int!
    renameTag(oldName: String!, newName: String!): Tag!
    deleteTag(name: String!): Boolean!
    clearCache(type: String!): CacheStats!
    clearAuditLogs(startDate: String!, endDate: String!): Int!
    updateCacheSettings(input: CacheSettingsInput!): CacheSettings!
    updateTimelineDateSource(dateSource: String!): TimelineSettings!
    restoreTrashItem(id: ID!): Boolean!
    purgeTrashItem(id: ID!): Boolean!
    emptyTrash: Int!
  }
`;

export const schema = [
  authSdl,
  mediaSdl,
  directorySdl,
  tagsSdl,
  compressSdl,
  cacheAuditSdl,
  timelineSdl,
  trashSdl,
  rootSdl,
].join('\n');
