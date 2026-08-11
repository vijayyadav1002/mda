import type { GraphQLContext } from '../context.js';
import { authQueryResolvers, authMutationResolvers } from './auth.resolvers.js';
import { mediaQueryResolvers, mediaMutationResolvers, mediaAssetTypeResolvers } from './media.resolvers.js';
import { directoryQueryResolvers, directoryMutationResolvers } from './directory.resolvers.js';
import { tagsQueryResolvers, tagsMutationResolvers } from './tags.resolvers.js';
import { thumbnailsMutationResolvers } from './thumbnails.resolvers.js';
import { compressMutationResolvers } from './compress.resolvers.js';
import { cacheAuditQueryResolvers, cacheAuditMutationResolvers } from './cache-audit.resolvers.js';
import { timelineQueryResolvers, timelineMutationResolvers } from './timeline.resolvers.js';
import { trashQueryResolvers, trashMutationResolvers } from './trash.resolvers.js';

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
