# User accounts and authentication

Defaults: email/password, JWT, and SQLite.

## 1. New component — user store (`server/db.py`)

Persist accounts and job ownership.

Supporting: configure `DATABASE_URL`.

## 2. Auth module (`server/auth.py`)

Hash passwords and validate bearer tokens.

## 3. Auth endpoints (`server/routes_auth.py`)

Register, login, and return the current user.

## 4. Protect the existing API (`server/api.py`)

Require the current user for analysis and job routes.

## 5. Job ownership (`server/api.py`)

Scope every job to its owner.

## 6. Authenticated client API (`app/lib/api.ts`)

Attach the bearer token to requests.

## 7. Client session (`app/lib/auth.tsx`)

Add secure token storage and login/register screens.

## 8. Tests (`server/test_auth.py`)

Cover authentication and cross-user job isolation.

## Also proposed

An optional history screen.

## Order

Build the backend before the client.
