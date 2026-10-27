[TUTORIAL.md](https://github.com/user-attachments/files/34052105/TUTORIAL.md)
# Stickman Game: Google Login + Cloud Saves (free setup)

You'll end up with a game on Vercel where players sign in with Google, and their coins and cards follow them to any device.

**Files in this folder**

| File | What it does |
|---|---|
| `index.html` | The game page (your v10 game, plus one script tag) |
| `cloud.js` | Adds the Google sign-in button and syncs saves |
| `api/save.js` | Vercel server function that checks the sign-in and stores saves |
| `supabase_setup.sql` | Creates the table that holds saves |

You'll need free accounts at **Google Cloud**, **Supabase**, **GitHub**, and **Vercel**.

---

## Step 1: Google sign-in (about 10 minutes)

1. Go to https://console.cloud.google.com and create a new project called `Stickman Game`.
2. Go to **Google Auth Platform** (or **APIs & Services → OAuth consent screen**):
   - **User type:** External
   - **App name:** Stickman Game, plus your email as the support and developer contact
   - **Scopes:** leave at the defaults (email, profile, openid). These are "non-sensitive", so you don't need Google's verification.
   - **Test users:** while the app is in Testing, only test users can sign in. Add your own Google email here. When you're ready, click **Publish app** so anyone can sign in.
3. Go to **Clients → Create client**:
   - **Application type:** Web application
   - **Name:** Stickman Web
   - **Authorized JavaScript origins:** add your Vercel address, for example `https://stickman-game.vercel.app`. Add `http://localhost:3000` too if you test on your own computer.
   - Leave **Authorized redirect URIs** empty. Sign-in here doesn't use redirects.
4. Click **Create**. Copy the **Client ID**. It ends with `.apps.googleusercontent.com`.
   - You don't need the client secret for this setup, so you can ignore it.

## Step 2: Supabase database (about 5 minutes)

1. Go to https://supabase.com, sign in, and click **New project**. Pick a name, a database password (save it), and the region closest to you.
2. Wait for the project to finish setting up.
3. Click **SQL Editor → New query**. Open `supabase_setup.sql`, paste everything into the editor, and click **Run**. You should see "Success".
4. Go to **Project Settings → API**. Copy:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **service_role** key, under "Project API keys"
   - **Keep the service_role key secret.** It bypasses the table's security, so only put it in Vercel's settings, never in the game files.

## Step 3: Put the code on GitHub (about 5 minutes)

1. Open the file `cloud.js` and replace the placeholder on this line with your Client ID from Step 1:
   ```js
   const GOOGLE_CLIENT_ID = 'PASTE_YOUR_CLIENT_ID.apps.googleusercontent.com';
   ```
   The Client ID is not secret, so it's fine in this file.
2. Go to https://github.com, click **New repository**, name it `stickman-game`, and set it to **Private**.
3. Click **uploading an existing file**, drag in the whole folder contents (`index.html`, `cloud.js`, the `api` folder, `supabase_setup.sql`, `TUTORIAL.md`), and click **Commit changes**.
   - Make sure the `api` folder uploads with its `save.js` file inside it.

## Step 4: Deploy on Vercel (about 5 minutes)

1. Go to https://vercel.com, sign in with GitHub, and click **Add New → Project**.
2. Find `stickman-game` and click **Import**.
3. Leave the build settings alone. This is a plain site, so no build command is needed.
4. Before clicking Deploy, open **Environment Variables** and add these three:

   | Name | Value |
   |---|---|
   | `GOOGLE_CLIENT_ID` | your Client ID from Step 1 |
   | `SUPABASE_URL` | your Project URL from Step 2 |
   | `SUPABASE_SERVICE_ROLE_KEY` | your service_role key from Step 2 |

5. Click **Deploy**. When it finishes, you'll get an address like `https://stickman-game.vercel.app`.
6. If that address isn't the one you added in Step 1, go back to Google Cloud, add it under **Authorized JavaScript origins**, and wait a few minutes.

## Step 5: Test it

1. Open your Vercel address. The sign-in bar appears in the top-right corner.
2. Click **Sign in with Google** and pick your account. You should see "Signed in as …" and "Save uploaded".
3. Play a bit: buy a pack or train to earn coins. The status shows "Saved" a moment later.
4. Open the site in another browser (or a private window) and sign in with the same Google account. Your coins and cards should appear.

If you change your mind about the old save, Export/Import in the backup menu still works.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| The Google button doesn't appear | Open the browser console. If it says "origin not allowed", the Vercel address is missing from **Authorized JavaScript origins**. Add it exactly, including `https://` and no trailing slash. |
| "Sign-in expired" right after signing in | Check that `GOOGLE_CLIENT_ID` in Vercel matches the Client ID in `cloud.js` exactly. |
| "Could not save." | Check that `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are right, and that you ran `supabase_setup.sql`. Vercel's **Logs** tab shows the exact error. |
| Google says "access blocked" | Your email isn't in the test users list, or the app isn't published. Add the email under **Test users**, or click **Publish app**. |
| Changes to Vercel settings don't seem to apply | Go to **Deployments** and click **Redeploy**. |

## Things to know

- **Free-tier limits:** Supabase pauses a free project after 7 days with no activity. Restart it from the dashboard if the game stops saving. Vercel's free plan is meant for personal, non-commercial use.
- **Every player gets a save row**, so the table grows with your player count. Each save is limited to about 2 MB.
- **Old progress:** the first time someone signs in on a browser that already has progress, that progress is uploaded. After that, the cloud save is what loads.
- **Testing limit:** I checked the server logic with mocked Google and Supabase responses, but I couldn't reach either service from my sandbox. The first real sign-in is the one step only you can confirm.
