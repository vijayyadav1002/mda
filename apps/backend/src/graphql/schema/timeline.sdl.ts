export const timelineSdl = `
  type TimelineBucket {
    period: String!
    count: Int!
    coverAssets: [MediaAsset!]!
  }

  type TimelineAssetsResult {
    assets: [MediaAsset!]!
    totalCount: Int!
  }

  type TimelineSettings {
    dateSource: String!
  }
`;
