export const mediaSdl = `
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
    capturedAt: String
    capturedAtPrecision: String
    tags: [Tag!]!
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
`;
