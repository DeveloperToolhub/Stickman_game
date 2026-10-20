# Username sign-in (no email, with secret words)

Players can now create an account with a username and password. On creation they get 6 random secret words, which they type at every sign-in.

**Sign-in needs three things:** username, password, and the 6 secret words. The words are the extra protection: someone who learns the password still can't get in without them.

## What's new in the folder

| File | Change |
|---|---|
| `lib/auth.js` | New. Password hashing, secret-word generation, session tokens (built-in Node crypto only) |
| `api/account.js` | New. Create account and sign in |
| `api/save.js` | Accepts Google tokens or username tokens |
| `cloud.js` | Adds the "Username sign-in" button and create/sign-in screens |
| `supabase_accounts.sql` | New table for username accounts |

Your Google sign-in and existing saves keep working. Username saves are stored separately, under a `local:` prefix.

## Setup (about 5 minutes)

**1. Create the table.** In Supabase, open **SQL Editor**, paste `supabase_accounts.sql`, and click **Run**.

**2. Add a session secret.** Make a long random string on your computer:
- Mac/Linux: `openssl rand -hex 32`
- Windows PowerShell: `[guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")`

In Vercel, go to **Project → Settings → Environment Variables** and add:

| Name | Value |
|---|---|
| `SESSION_SECRET` | the random string |

**3. Upload the changed files** to your GitHub repo: `lib/auth.js` (new folder `lib`), `api/account.js` (new), `api/save.js`, `cloud.js`, and `supabase_accounts.sql`. Keep the same names and folders.

**4. Redeploy** in Vercel (**Deployments → Redeploy**) so the new variable takes effect.

## How players use it

1. Click **Username sign-in**, then **Create account**.
2. Pick a username and a password of at least 8 characters.
3. Write down the 6 secret words. They're shown once.
4. Type the words into the sign-in form to finish. This confirms they were saved.
5. Next time: username, password, and the 6 words.

## Rules built in

- Usernames are 3–20 letters, numbers, or underscores, and not case-sensitive.
- Passwords and secret words are stored as salted scrypt hashes, never in plain text.
- After 5 wrong sign-in attempts, the account locks for 15 minutes.
- Sessions last 30 days.

## Important trade-offs

- **Lost secret words can't be recovered.** There's no email reset, by design. Tell players to keep their words somewhere safe.
- **Signing out only clears the browser.** A session token stays valid until it expires (30 days). To cut off every session at once, change `SESSION_SECRET` in Vercel and redeploy.
- **The lockout reveals that a username exists.** A locked account says "too many tries", while an unknown username gets the normal wrong-details message. That's a small leak, and it's the cost of the lockout.

## If something goes wrong

| Message | Fix |
|---|---|
| "Server auth is not configured" | `SESSION_SECRET` is missing in Vercel, or you didn't redeploy after adding it. |
| "Could not create the account (server code 404)" | The `local_users` table doesn't exist. Run `supabase_accounts.sql`. |
| "Could not create the account (server code 401)" | `SUPABASE_SERVICE_ROLE_KEY` is wrong. |
| "Too many failed tries" | Wait 15 minutes, or clear the account's `failed_attempts` and `locked_until` in Supabase's Table Editor. |
