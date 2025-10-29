### Frontend
- React with Remix Router (SSR)
- shadcn UI components
- Render the exact filesystem directory structure
- Display preview thumbnails for all media assets
- make use of turborepo for monorepo management


### Backend
- Fastify server with Mercurius GraphQL
- PostgreSQL for persistence

### Core Requirements
- Index an existing media library supporting .heic, .jpeg, .png, .mp4, and other common formats
- Generate and cache thumbnails for media listings

### Shared Capabilities
- Compress images and videos; support overwriting or creating derivative media
- Move, delete, and rename media assets with audit logging
- Role-based authentication:
  - Admin: full read/write access
  - ReadOnly: view-only access
- On first launch, prompt for admin account creation if none exists


Based on above instruction start implementing in the current directory