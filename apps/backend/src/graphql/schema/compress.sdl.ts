export const compressSdl = `
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
`;
