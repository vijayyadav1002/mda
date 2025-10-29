# Frontend Setup

## Prerequisites

- Node.js >= 18
- Backend API running

## Installation

1. Install dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env
```

Edit `.env`:
```
VITE_API_URL=http://localhost:4000
```

## Development

Start development server:
```bash
npm run dev
```

The app will be available at http://localhost:3000

## Production

Build for production:
```bash
npm run build
```

Preview production build:
```bash
npm start
```

## Features

### Authentication
- Login page with JWT token management
- First-time admin account creation
- Automatic token storage in localStorage

### Dashboard
- Grid view of media assets
- Thumbnail previews
- File information display
- Tree view for directory structure (coming soon)

### UI Components

Built with shadcn UI:
- Button
- Input
- Card
- Dialog
- Dropdown Menu
- Label

## Project Structure

```
app/
├── components/
│   └── ui/              # UI components (shadcn)
├── lib/
│   ├── api.ts           # GraphQL client setup
│   └── utils.ts         # Utility functions
├── routes/
│   ├── _index.tsx       # Home route (redirects)
│   ├── login.tsx        # Login/signup page
│   └── dashboard.tsx    # Main dashboard
├── styles/
│   └── globals.css      # Global styles with Tailwind
└── root.tsx             # Root layout
```

## Routing

Using Remix file-based routing:

- `/` - Home (redirects to dashboard)
- `/login` - Login/first-time setup
- `/dashboard` - Main media browser

## State Management

Currently using React hooks and localStorage for:
- Authentication token
- User session

## API Integration

GraphQL queries and mutations via `graphql-request`:

```typescript
import { createGraphQLClient } from '~/lib/api';

const client = createGraphQLClient(token);
const data = await client.request(QUERY, variables);
```

## Styling

- Tailwind CSS for utility-first styling
- CSS variables for theming
- Dark mode support (configured)

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | Backend API URL | `http://localhost:4000` |

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm start` - Preview production build
- `npm run clean` - Remove build artifacts
