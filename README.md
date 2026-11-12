# Tracebook — Backend API

Express, MongoDB, and Socket.io backend for Tracebook.

## Setup
```bash
npm install
cp .env.example .env
npm run seed   # optional: 3 demo projects, 5 users, 30 tickets, ~25 comments
npm run dev
```

## Scripts
- `npm run dev` — Start development server with nodemon
- `npm start` — Start production server
- `npm test` — Run API, key-generation, permission, upload, and Socket.io tests (`mongodb-memory-server`)
- `npm run seed` — Populate demo users, projects, tickets, comments, and sample screenshots
- `npm run migrate:keys` — Backfill missing project keys and sequential ticket numbers on older databases

## Environment Variables
- `PORT` (default `5000`)
- `NODE_ENV` (`development` | `production`)
- `MONGO_URI`
- `JWT_SECRET`
- `CLIENT_URL`
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (optional; falls back to `uploads/` when unset)
