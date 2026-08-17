export const directorySdl = `
  type DirectoryNode {
    name: String!
    path: String!
    type: String!
    children: [DirectoryNode!]
    mediaAsset: MediaAsset
    size: Float
  }
`;
