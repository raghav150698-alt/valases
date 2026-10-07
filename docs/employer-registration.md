# Employer registration

New employer signup collects:

| Input | Requirement | Use |
| --- | --- | --- |
| Legal / registered business name | Required | Retained separately for later registry checks |
| Brand / trading name | Required | Organization display name in hiring and candidate invitations |
| Administrator full name | Required | Account profile |
| Administrator work email | Required, company domain | Login identity and email confirmation |
| Business country | Required | Registration jurisdiction |
| Business website | Optional, HTTP(S) URL | Declared business information |
| Password | Required | Account authentication |

The legal and brand names may match or differ. Email confirmation is required
for production Supabase employer self setup. It establishes mailbox control,
not legal ownership of the company, brand or website. The administrator email
stored in the business profile comes from the authenticated identity, not a
client-supplied business-profile email or claimed verification status.

After confirmation, a new employer's declared details initialize the free
organization and owner membership. Repeated logins do not overwrite Company
profile from mutable auth metadata or create another organization. Existing
accounts and OAuth users without declared details receive a Complete profile
prompt; they can enter the names, country and website in Settings. Organization
administrators can edit these details there. Changing a legal name, brand name
or registration country resets any registry-check status to Not checked.

Business registry checks, including GSTIN, remain optional and separate. This
change records the registration details and distinguishes email confirmation
from registry status; it does not connect a paid GSTIN API or assert ownership.
Legacy local signup can retain the same declared details but cannot label its
email Confirmed without actual email confirmation. Existing access controls,
monthly free allowances and paid-tool restrictions remain in force.

Storage uses existing Organization.legal_name, Organization.name and the
business_profile section of Organization.settings_json. No schema migration is
needed. The signup and profile-edit regression tests cover separate names,
authenticated administrator email, untrusted metadata claims, invalid inputs,
repeat login, both authentication entry points, local legacy behavior and
registry-status reset. Browser and real email-delivery acceptance remain staging
checks. No production deployment or real signup email was sent by this change.
