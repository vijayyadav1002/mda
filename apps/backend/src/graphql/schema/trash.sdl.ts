export const trashSdl = `
  type TrashItem {
    id: ID!
    fileName: String!
    originalPath: String!
    itemType: String!
    fileSize: String
    mimeType: String
    thumbnailUrl: String
    deletedAt: String!
    expiresAt: String!
  }
`;
