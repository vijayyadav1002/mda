import { gql } from 'graphql-request';

export const ME = gql`
  query Me {
    me {
      id
      username
      role
      createdAt
    }
  }
`;

export const DELETE_MEDIA_ASSET = gql`
  mutation DeleteMediaAsset($id: ID!) {
    deleteMediaAsset(id: $id) {
      success
      message
    }
  }
`;