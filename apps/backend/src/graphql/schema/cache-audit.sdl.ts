export const cacheAuditSdl = `
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

  type CacheSettings {
    thumbnailCacheMaxMb: Int!
    previewCacheMaxMb: Int!
    hlsCacheMaxMb: Int!
    transcodedCacheMaxMb: Int!
    previewCacheMaxAgeDays: Int!
    hlsCacheMaxAgeHours: Int!
  }

  input CacheSettingsInput {
    thumbnailCacheMaxMb: Int
    previewCacheMaxMb: Int
    hlsCacheMaxMb: Int
    transcodedCacheMaxMb: Int
    previewCacheMaxAgeDays: Int
    hlsCacheMaxAgeHours: Int
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
