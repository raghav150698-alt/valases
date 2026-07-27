# Organization access, integrations, and SSO

## Access model

Valases evaluates permissions on the API and uses the same permission list to
shape the recruiter interface.

- `owner` and `org_admin`: all organization controls.
- `recruiter`: all hiring, assessment, interview, reporting, and integration
  controls except member administration, organization security, SSO, and
  billing.
- `custom`: only explicitly selected permissions.

Organization admins invite members from **Settings > People & access**.
Supabase sends the invitation email; the service key stays on the backend.

Apply `docs/sql/20260728_organization_access_control.sql` to every regional
Supabase database before deploying this release.

## Integration OAuth

OAuth tokens are encrypted before storage. Add a separate Fernet key to each
backend Vercel project:

```powershell
.\.codex-run-venv\Scripts\python.exe -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Set the result as `INTEGRATION_TOKEN_ENCRYPTION_KEY`. Never prefix this variable
with `VITE_`.

Provider OAuth applications are supplied through one server-only JSON variable,
`INTEGRATION_OAUTH_CONFIG_JSON`. Example:

```json
{
  "google_calendar": {
    "client_id": "google-client-id",
    "client_secret": "google-client-secret",
    "authorization_url": "https://accounts.google.com/o/oauth2/v2/auth",
    "token_url": "https://oauth2.googleapis.com/token",
    "scopes": ["openid", "email", "https://www.googleapis.com/auth/calendar"],
    "authorize_params": {"access_type": "offline", "prompt": "consent"}
  },
  "outlook_calendar": {
    "client_id": "microsoft-client-id",
    "client_secret": "microsoft-client-secret",
    "authorization_url": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    "token_url": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    "scopes": ["openid", "email", "offline_access", "Calendars.ReadWrite"]
  },
  "microsoft_teams": {
    "client_id": "microsoft-client-id",
    "client_secret": "microsoft-client-secret",
    "authorization_url": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    "token_url": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    "scopes": ["openid", "email", "offline_access", "Calendars.ReadWrite", "OnlineMeetings.ReadWrite"]
  }
}
```

Register this callback URL in each provider application:

```text
https://<backend-domain>/hiring/integrations/oauth/callback
```

Use the Tokyo backend domain for Tokyo and the Mumbai backend domain for
Mumbai. OAuth applications can share both callback URLs when the provider
allows multiple redirects.

## Organization SSO

The login page starts SAML SSO by extracting the domain from the entered work
email and calling Supabase `signInWithSSO`. Before enabling a Valases SSO
policy:

1. Configure the customer's SAML identity provider in the matching regional
   Supabase project.
2. Associate the customer's verified email domain with that provider.
3. Add the Valases recruiter URL to the Supabase redirect allow list.
4. Test with a non-admin customer account.
5. Enable and then enforce SSO in **Settings > Single sign-on**.

The Valases policy controls organization behavior and audit history. The actual
SAML trust, certificates, metadata, and assertion validation remain in
Supabase Auth and the customer's identity provider.
