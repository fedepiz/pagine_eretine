# Monterotondo Town Pages

Basic starter stack for a QR-driven town information app:

- `frontend/`: React + TypeScript single-page app built with Vite
- `backend/`: Rust API built with Axum

## What is included

- Synthetic article data (no database yet)
- API endpoints for page list and page detail
- React routes for home and article pages (`/p/:slug`)
- Frontend dev proxy to backend API (`/api`)

## Run locally

1. Start backend:

```bash
cd backend
cargo run
```

2. Start frontend in a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173` and calls backend at `http://localhost:3000`.
If needed, copy `frontend/.env.example` to `frontend/.env.local` and customize `VITE_API_BASE_URL`.

## API endpoints

- `GET /api/health`
- `GET /api/pages`
- `GET /api/pages/{slug}`

## Next logical steps

- Replace synthetic pages with database-backed storage
- Add admin flow to create/update pages
- Generate and attach QR codes to each page slug
