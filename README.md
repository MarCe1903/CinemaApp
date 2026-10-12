# Cinema

A responsive cinema booking application built with React, TypeScript, ASP.NET Core and SQL Server. Browse movies, choose a screening, select seats and download a PDF ticket. The application includes member and guest checkout, role-based administration, English/Turkish interfaces and light/dark themes.

**Demo payments only:** the checkout validates input formats and completes a simulated purchase. It does not contact a payment provider or charge a card. Use fictional payment details.

## Features

- Movie catalogue with genre filters, search, sorting and screening details.
- Interactive seating plan with occupancy refreshed every four seconds and when the window regains focus.
- Database-enforced seat uniqueness and transactional booking to prevent duplicate sales. Prices are calculated by the API.
- Member accounts with ASP.NET Core Identity password hashing and HttpOnly session cookies.
- Guest checkout without creating an account; ticket-specific cookies protect guest PDF downloads.
- PDF tickets generated on the server, with an embedded font for Turkish text.
- Management tools for movies, screenings and PNG posters; existing artwork is preserved when no image is uploaded.
- Screening conflict checks, including movie duration and a 15-minute interval. Screenings with sold tickets are protected from changes and deletion.
- Role updates take effect in existing sessions because the API checks current permissions on each request.
- Persistent light/dark theme and TR/EN preferences. Dates use Turkey time and prices use TRY; user-entered movie content is not automatically translated. PDF ticket text is Turkish.

### Access roles

| Role | Access |
| --- | --- |
| Member | Browse movies, book seats and view their own tickets |
| Manager | Member access plus movie, poster and screening management |
| Admin | Management access plus member/role administration and all tickets |

Guests can book seats and download the ticket from the confirmation screen. Guest purchases are not added to a member account and no email is sent.

## Technology

| Layer | Stack |
| --- | --- |
| Frontend | React 19, TypeScript, Vite 8 |
| Backend | C#, ASP.NET Core 8, Entity Framework Core 8, ASP.NET Core Identity |
| Database | SQL Server 2022 Developer in Docker, with a persistent volume |
| Tickets | PDFsharp with an embedded DejaVu Sans font |
| Validation | Node.js tests, TypeScript build and Oxlint |

## Run locally

### Prerequisites

- .NET SDK with .NET 8 targeting support.
- Node.js 24 and npm.
- Docker with Compose v2, configured for Linux containers.
- PowerShell for the database setup script.

Run these commands from the repository root. The frontend and API run in separate terminals.

### 1. Set up SQL Server and start the API

```powershell
./scripts/setup-database.ps1
dotnet restore backend/Cinema.Api
dotnet run --project backend/Cinema.Api --launch-profile http
```

The setup script generates separate random SQL and development-admin passwords. It stores them in local files excluded from Git, preserves existing configuration values and starts the database container. SQL Server is bound to `127.0.0.1:14333`, so it is accessible only from the local machine.

On the first Development startup, the API creates tables and seeds six fictional movies, seven days of screenings and seat inventory. Subsequent starts do not recreate edited or deleted screenings. Add new screenings in the management panel when the sample schedule expires.

### 2. Start the frontend

```powershell
cd frontend
npm ci
npm run dev
```

| Service | Address |
| --- | --- |
| Web application | http://127.0.0.1:5173 |
| API | http://localhost:5080 |
| SQL Server | `127.0.0.1,14333` |

Vite proxies `/api` requests to the backend. Use the same browser hostname throughout a session; `localhost` and `127.0.0.1` have separate cookies. Set `CINEMA_API_PROXY` before starting Vite to use a different API address.

### Development administrator

For a new database, the development username is `admin`. Its password is the `Cinema.SeedAdminPassword` value in `backend/Cinema.Api/appsettings.Local.json`; open this local file to retrieve it. There is no shared or hardcoded admin password.

Admin creation is optional, runs only in Development and requires a configured password that satisfies the normal Identity password policy. Existing accounts, passwords and roles are never reset. For an existing installation, the generated seed value does not replace the account's current password. Admin accounts are not automatically created in Production.

### Stop and restart

Press **Ctrl+C** in each frontend/API terminal to stop that process. Manage the database separately:

```powershell
docker compose stop
docker compose start
docker compose ps
```

`docker compose down` removes containers but retains the database volume. **`docker compose down -v` deletes the database volume and its data.**

## Configuration

| Setting | Purpose |
| --- | --- |
| `.env` → `MSSQL_SA_PASSWORD` | SQL Server container password |
| `ConnectionStrings: Cinema` | API database connection string |
| `Cinema: SeedAdminPassword` | Optional password for first-time Development admin creation |
| `CINEMA_API_PROXY` | Vite's backend proxy target |
| `CINEMA_API_URL` | API address used by integration tests |
| `CINEMA_TEST_ADMIN_USER` | Integration-test admin username; defaults to `admin` |
| `CINEMA_TEST_ADMIN_PASSWORD` | Required by admin and poster integration tests |

The API reads `appsettings.Local.json`, then environment variables and command-line arguments. Environment variables use double underscores for nested keys, such as `ConnectionStrings__Cinema` and `Cinema__SeedAdminPassword`.

The setup script creates the local configuration automatically. For manual configuration, copy [`appsettings.Local.example.json`](backend/Cinema.Api/appsettings.Local.example.json) to `appsettings.Local.json` and replace its placeholders. The example contains no working credentials. Local settings are excluded from Git and from `dotnet publish` output.

To connect using a SQL client or the VS Code SQL Server extension:

```text
Server: 127.0.0.1,14333
Database: CinemaApp
Authentication: SQL Login
User: sa
Password: the MSSQL_SA_PASSWORD value in your local .env
Trust server certificate: Yes (local development only)
```

Changing the `.env` password does not change the login password inside an existing SQL volume. Preserve the current value unless you intentionally change the SQL login as well.

### Optional legacy LocalDB import

Windows installations with an older `CinemaApp` database in `(localdb)\MSSQLLocalDB` can perform an explicit one-time import. Run it against an empty destination before the first normal API startup:

```powershell
dotnet run --project backend/Cinema.Api -- --import-localdb=true
```

The importer reads the source without modifying it, copies the legacy tables in one transaction and refuses to overwrite a populated destination. It is intended for the older schema; it does not import the newer PNG poster table. There is no automatic fallback to LocalDB.

## Validation

Build and lint without starting application servers:

```powershell
dotnet build backend/Cinema.Api
npm --prefix frontend run build
npm --prefix frontend run lint
node --test tests/payment.test.mjs
```

Run API integration tests against a **dedicated Development test database** with the API already running. Override `ConnectionStrings__Cinema` when starting that API, and set a test-only `Cinema__SeedAdminPassword` before its first startup. In the test terminal, supply the matching credentials:

```powershell
$env:CINEMA_API_URL = 'http://localhost:5080'
$env:CINEMA_TEST_ADMIN_USER = 'admin'
$env:CINEMA_TEST_ADMIN_PASSWORD = '<YOUR_TEST_ADMIN_PASSWORD>'
node --test tests/api.test.mjs tests/admin.test.mjs tests/payment.test.mjs tests/posters.test.mjs
```

Integration tests write sample accounts, movies, bookings and tickets to SQL Server. Some test records remain afterward; do not run them against a database containing real customer data. Generated PDFs and PNGs are written under the ignored `artifacts/` directory.

Coverage includes authentication, booking/PDF ownership, guest access, seat conflicts, server-side pricing, payment formats, roles and role revocation, screening conflicts, sold-screening protection, and poster upload validation. PNG uploads are limited to 5 MB, 8,000 pixels per dimension and 32 million pixels; a 2:3 portrait ratio is recommended.

## Project layout

```text
backend/Cinema.Api/   API, Identity, EF Core models, seed data and PDF generation
backend/Models/       Legacy model retained from the earlier project structure
frontend/src/        React interface, booking flow, administration and styles
scripts/             Local Docker database setup
tests/               Payment unit tests and API integration tests
compose.yaml         SQL Server service and persistent storage
```

## Privacy and publishing

- Keep `.env`, local settings, database files/backups, logs, build outputs and generated tickets out of Git. The repository includes ignore rules for these files; never force-add them.
- The application stores account details, password hashes, booking records, guest contact details and uploaded posters in the local SQL database. Publishing source code does not publish that database.
- Card fields are validated during a request and are not stored in the database or deliberately logged. Do not enter real payment information in this demo.
- Review Git history as well as the current files before making a repository public. Removing a file from the latest version does not erase earlier commits. Commit author names and email addresses are also public Git metadata.
- Rotate any credential that has previously been published, even if the corresponding file is later removed.

Making this repository public shares its source code. It does not deploy the full application: GitHub Pages cannot run the ASP.NET API or SQL Server. Running a public service requires separate backend and database hosting.

## Scope and deployment considerations

This project is a local development demo, with one cinema, six auditoriums and 96 seats per screening. A booking can include up to eight seats. Seats are reserved only when the purchase is committed; there is no temporary checkout hold.

Refunds, cancellations, password recovery, email verification and real payment processing are not implemented. Payment validation checks required fields, 16 card digits, a valid month in `MM/YY` and three CVV digits; it does not check expiry against the current date, Luhn validity or bank authorization.

Before deploying, introduce a managed schema migration process, HTTPS, persistent and protected authentication keys, request throttling, backups and appropriate secret management. Development uses `EnsureCreated` plus additive setup for the poster table; this is not a production migration strategy. Production does not seed the schema or administrator. Local certificate-trust overrides and the SQL Developer image are intended for development.

Movie metadata and initial artwork are fictional demo content. The initial posters are CSS artwork; uploaded PNGs override them. Google Fonts are requested by the interface, with system-font fallbacks. The bundled font's license is included in [`Fonts/LICENSE.txt`](backend/Cinema.Api/Fonts/LICENSE.txt).
