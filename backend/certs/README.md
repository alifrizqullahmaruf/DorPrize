# Supabase PostgreSQL CA

`supabase-prod-ca-2021.crt` is a **public CA certificate**, not a signing key or
database credential. It is required to verify the Supabase pooler's certificate
chain when Node's default trust store does not contain this CA.

- Official dashboard source: <https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json>
- The dashboard's `ssl:certificate_url` template resolves to
  <https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt>.
- Subject: `Supabase Root 2021 CA`, Supabase Inc.
- SHA-256 certificate fingerprint:
  `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.
- Valid until April 26, 2031, 10:56:53 UTC.

Add these query parameters to the secret `DATABASE_URL`:

```text
sslmode=verify-full&sslrootcert=certs/supabase-prod-ca-2021.crt
```

The relative path assumes the process runs in `backend/`, as it does with
`npm run start -w @dorprize/backend`. A local check from repo root can instead
use an absolute path; URL-encode the parameter, especially spaces on Windows.
Never copy a Windows certificate path into Render's environment.

Keep certificate and hostname verification enabled. Do not work around a failed
connection with `NODE_TLS_REJECT_UNAUTHORIZED=0` or `rejectUnauthorized: false`.
When Supabase rotates its CA, obtain the replacement through the official
dashboard/source, review its subject, validity and fingerprint, then update
the committed certificate and this record. Downloading a CA alone does not
configure a driver to trust it.

Official connection guidance:
<https://supabase.com/docs/guides/platform/ssl-enforcement>.
