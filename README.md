# Bug Tracker — Backend API

Express + MongoDB + Socket.io backend for the Bug Tracker application.

## Setup
```bash
npm install
cp .env.example .env
npm run seed   # optional demo data
npm run dev
```

## Scripts
- `npm run dev` — Start development server with nodemon
- `npm start` — Start production server
- `npm test` — Run API, security, upload, and Socket.io tests (`mongodb-memory-server`)
- `npm run seed` — Populate demo users, project, 15 tickets, and comments

## Environment Variables
- `PORT` (default `5000`)
- `NODE_ENV` (`development` | `production`)
- `MONGO_URI`
- `JWT_SECRET`
- `CLIENT_URL`
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (optional; falls back to `uploads/` when unset)
