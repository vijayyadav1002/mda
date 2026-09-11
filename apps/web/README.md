# Frontend Setup

## Prerequisites

- Node.js >= 24
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

Leave `VITE_API_URL` unset (or commented) in `.env`. The Vite dev server proxies API paths so the browser stays same-origin, which cookies require. Set `VITE_API_URL` only when the page origin is already the API origin — `http://localhost:4000` from `:3000` is unsupported.

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
- Login page with HttpOnly cookie sessions
- First-time admin account creation
- Signed-in presence flag in localStorage (`mda_signed_in`; the JWT is not stored there)

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

Currently using React hooks for UI state. Auth is an HttpOnly cookie (`mda_session`); `localStorage.mda_signed_in` is a non-secret presence flag only.

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
| `VITE_API_URL` | Optional API origin override. Default is same-origin via the Vite proxy. Set only when the page origin is already the API origin. | unset |

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm start` - Preview production build
- `npm run clean` - Remove build artifacts
