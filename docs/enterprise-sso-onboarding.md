# Enterprise SSO onboarding

Valases uses one SAML 2.0 implementation for all compatible identity
providers. Microsoft Entra ID, Okta, Google Workspace, Ping Identity,
OneLogin, WSO2, and other SAML providers are setup presets, not separate
authentication integrations.

## Responsibilities

Valases:

- Creates the organization in the correct data region.
- Pre-authorizes the first organization administrator as SSO-only.
- Supplies the service-provider metadata, Entity ID, ACS URL, NameID format,
  and required email claim.
- Registers and validates the customer's IdP metadata.
- Enables enforcement only after a successful test login.
- Monitors signing-certificate expiry and authentication audit events.

Customer IT:

- Creates a Valases SAML application in its existing identity provider.
- Assigns one or two pilot users.
- Maps NameID and the required email claim.
- Supplies an HTTPS IdP metadata URL or metadata XML file.
- Approves enforcement after the pilot succeeds.

Customers do not provide passwords, private signing keys, or a complete
employee directory.

## Product workflow

1. Create the customer organization and choose its region.
2. Open `Settings > Single sign-on`.
3. Select the customer's identity provider.
4. Add the verified company domain and initial administrator email.
5. Give the displayed service-provider values to customer IT.
6. Save the customer's IdP metadata URL. Metadata XML is handled by the
   controlled operator workflow.
7. Open `Team > Add team member`, choose `Company SSO`, and pre-authorize the
   initial administrator.
8. Register the IdP connection in Supabase.
9. Ask the initial administrator to use `Continue with company SSO`.
10. The first valid SAML session activates the pending membership and marks
    the connection verified.
11. Enable SSO, then enable enforcement after customer approval.

Enforcement remains locked until the connection has been verified.

## Tokyo project

Project reference:

```text
grnwbbkbhqzmztmnzvwn
```

Service-provider values:

```text
Entity ID:
https://grnwbbkbhqzmztmnzvwn.supabase.co/auth/v1/sso/saml/metadata

ACS / Reply URL:
https://grnwbbkbhqzmztmnzvwn.supabase.co/auth/v1/sso/saml/acs

Metadata URL:
https://grnwbbkbhqzmztmnzvwn.supabase.co/auth/v1/sso/saml/metadata

Metadata XML download:
https://grnwbbkbhqzmztmnzvwn.supabase.co/auth/v1/sso/saml/metadata?download=true

NameID:
urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress

Required claim:
email
```

## Edutrip India pilot

```text
Organization domain: edutripindia.com
Initial administrator: founders@edutripindia.com
Region: Tokyo
Test identity provider: WSO2
Provisioning: Invite only
```

Do not create a password-based Supabase identity for
`founders@edutripindia.com`. Add the user with the `Company SSO` sign-in
method so the membership remains `pending_sso` until the first valid SAML
login.

## Supabase activation

SAML must first be enabled on a Supabase Pro project. After customer IT
provides its metadata URL:

```cmd
supabase login

supabase sso add ^
  --project-ref grnwbbkbhqzmztmnzvwn ^
  --type saml ^
  --metadata-url "https://CUSTOMER-IDP/SAML/METADATA" ^
  --domains edutripindia.com

supabase sso list --project-ref grnwbbkbhqzmztmnzvwn
```

For an XML file, replace `--metadata-url` with:

```cmd
--metadata-file "D:\secure-path\customer-metadata.xml"
```

Metadata files are configuration artifacts, not secrets, but they should
still be handled through the controlled operator workspace and not committed
to Git.

## Launch controls

- Keep SSO disabled while metadata is pending.
- Keep enforcement disabled until the customer completes a test login.
- Use fresh SSO-only identities for the pilot. Supabase does not link SAML
  identities to existing password identities.
- Start with invite-only membership. Add SCIM after its provisioning and
  deprovisioning endpoints have been completed and independently tested.
- Retain a separately controlled break-glass account with MFA. Do not use the
  same email as an SSO user.
- Test tenant isolation, role mapping, session expiry, audit logging, and
  deactivation before launch.
