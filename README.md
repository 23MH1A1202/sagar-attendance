# Sagar Attendance

A web application that fetches and tracks student attendance from the [AEC (Annamacharya Engineering College) portal](https://info.aec.edu.in/acet/Academics/StudentAttendance.aspx), stores data in Firebase Firestore, and sends real-time push notifications whenever attendance is updated.

## Features

- 📊 **Attendance Lookup** — Fetches today's, yesterday's, and overall attendance for any student by roll number using headless browser automation (Playwright).
- 🔔 **Push Notifications** — Notifies subscribed students whenever their attendance changes during college hours.
- 🗂️ **Notification History** — Saves all push notifications per student in Firestore so they can be reviewed later.
- 🤖 **Automated Polling** — A cron job checks attendance every 10 minutes on weekdays between 10 AM and 6:30 PM (IST).
- 📢 **Admin Broadcast** — An admin panel (`/notifiadmin`) lets administrators send targeted or broadcast messages to all subscribed users.
- 🐳 **Docker Ready** — Includes a `Dockerfile` for containerised deployment.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js |
| Web Framework | Express |
| Browser Automation | Playwright (Chromium) |
| Database | Firebase Firestore |
| Push Notifications | Web Push (VAPID) |
| Scheduler | node-cron |
| Containerisation | Docker |

## Project Structure

```
sagar-attendance/
├── server.js          # Main Express server (API routes, scraping logic, cron job)
├── templates/
│   ├── index.html     # Student-facing frontend (PWA)
│   ├── notifiadmin.html # Admin broadcast panel
│   ├── sw.js          # Service Worker (handles push notifications)
│   ├── manifest.json  # PWA manifest
│   └── logo.jpg / logo1.jpg / back-button.png
├── Dockerfile
├── package.json
└── .env               # (not committed — see Environment Variables below)
```

## Prerequisites

- Node.js ≥ 18
- A Firebase project with Firestore enabled (database ID: `sagarattendance`)
- VAPID key pair (generate with `npx web-push generate-vapid-keys`)
- Master credentials for the AEC portal

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/23MH1A1202/sagar-attendance.git
cd sagar-attendance
```

### 2. Install dependencies

```bash
npm install
```

> `postinstall` automatically installs the Chromium browser required by Playwright.

### 3. Configure environment variables

Create a `.env` file in the project root:

```env
PORT=8080

# AEC portal master account credentials
MASTER_USER=your_roll_number
MASTER_PASS=your_password

# VAPID keys for Web Push (generate with: npx web-push generate-vapid-keys)
VAPID_PUBLIC_KEY=your_vapid_public_key
VAPID_PRIVATE_KEY=your_vapid_private_key
```

### 4. Add Firebase service account

Place your Firebase service-account JSON file at the project root as **`firebase-key.json`**. This file is excluded from version control via `.gitignore`.

### 5. Run the server

```bash
npm start
```

The server starts on `http://localhost:8080` (or the port specified in `PORT`).

## Running with Docker

```bash
# Build the image
docker build -t sagar-attendance .

# Run the container (pass environment variables via --env-file)
docker run -p 8080:8080 --env-file .env \
  -v $(pwd)/firebase-key.json:/app/firebase-key.json \
  sagar-attendance
```

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Serves the student frontend (PWA) |
| `GET` | `/status` | Returns `{ ready: true/false }` — browser session health check |
| `GET` | `/ping` | Keeps the session alive; re-initialises browser if needed |
| `POST` | `/fetch-attendance` | Fetches attendance for a given `rollNo` (body: `{ rollNo }`) |
| `GET` | `/api/vapidPublicKey` | Returns the VAPID public key for push subscription |
| `POST` | `/api/subscribe` | Saves/updates a user's push subscription and name in Firestore |
| `GET` | `/api/notifications/:rollNo` | Returns the last 50 notifications for a student |
| `DELETE` | `/api/notifications/:rollNo/:id` | Deletes a specific notification from a student's history |
| `GET` | `/notifiadmin` | Serves the admin broadcast panel |
| `POST` | `/api/admin/users` | Lists all users with active notifications (requires `secret`) |
| `POST` | `/api/admin/broadcast` | Broadcasts a message to one or all subscribed users (requires `secret`) |

### Example: Fetch Attendance

```bash
curl -X POST http://localhost:8080/fetch-attendance \
  -H "Content-Type: application/json" \
  -d '{"rollNo": "23MH1A1202"}'
```

**Response:**
```json
{
  "yesterdayHtml": "<html>...",
  "dailyHtml": "<html>...",
  "overallHtml": "<html>..."
}
```

## Environment Variables Summary

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | HTTP port (default: `8080`) |
| `MASTER_USER` | Yes | AEC portal login username |
| `MASTER_PASS` | Yes | AEC portal login password |
| `VAPID_PUBLIC_KEY` | Yes | VAPID public key for push notifications |
| `VAPID_PRIVATE_KEY` | Yes | VAPID private key for push notifications |

## Cron Job

The cron job runs **every 10 minutes, Monday–Saturday, between 10:00 and 18:30 IST**. For every subscribed user with notifications enabled, it:

1. Fetches current attendance from the AEC portal.
2. Compares it with the last recorded attendance in Firestore.
3. Sends a push notification if anything has changed.
4. Saves the notification to the user's history in Firestore.

## License

This project is for personal/educational use.
