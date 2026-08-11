import type { GraphQLContext } from './context.js';
import { authQueryResolvers, authMutationResolvers } from './resolvers/auth.resolvers.js';
import { mediaQueryResolvers, mediaMutationResolvers, mediaAssetTypeResolvers } from './resolvers/media.resolvers.js';
import { directoryQueryResolvers, directoryMutationResolvers } from './resolvers/directory.resolvers.js';
import { tagsQueryResolvers, tagsMutationResolvers } from './resolvers/tags.resolvers.js';
import { thumbnailsMutationResolvers } from './resolvers/thumbnails.resolvers.js';
import { compressMutationResolvers } from './resolvers/compress.resolvers.js';
import { cacheAuditQueryResolvers, cacheAuditMutationResolvers } from './resolvers/cache-audit.resolvers.js';
import { timelineQueryResolvers, timelineMutationResolvers } from './resolvers/timeline.resolvers.js';
import { trashQueryResolvers, trashMutationResolvers } from './resolvers/trash.resolvers.js';

export const resolvers = {
  Query: {
    ...authQueryResolvers,
    ...mediaQueryResolvers,
    ...directoryQueryResolvers,
    ...tagsQueryResolvers,
    ...cacheAuditQueryResolvers,
    ...timelineQueryResolvers,
    ...trashQueryResolvers
  },

  MediaAsset: {
    ...mediaAssetTypeResolvers
  },

  Mutation: {
    ...authMutationResolvers,
    ...mediaMutationResolvers,
    ...directoryMutationResolvers,
    ...tagsMutationResolvers,
    ...thumbnailsMutationResolvers,
    ...compressMutationResolvers,
    ...cacheAuditMutationResolvers,
    ...timelineMutationResolvers,
    ...trashMutationResolvers
  }
};
