# Google Auth Setup Guide

I have added the "Sign in with Google" button to your application. To make it work, you need to configure the Google Provider in your Supabase Dashboard.

## 1. Configure Google Cloud Console
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or select an existing one).
3. Navigate to **APIs & Services > OAuth consent screen**.
4. Configure the consent screen (User Type: External).
5. Go to **Credentials > Create Credentials > OAuth client ID**.
6. Select **Web application**.
7. Add an **Authorized redirect URI**: 
   - `https://[YOUR_PROJECT_REF].supabase.co/auth/v1/callback`
   - (You can find your Project Ref in your Supabase URL: `https://[PROJECT_REF].supabase.co`)
8. Copy your **Client ID** and **Client Secret**.

## 2. Configure Supabase Dashboard
1. Go to your [Supabase Project Dashboard](https://supabase.com/dashboard).
2. Navigate to **Authentication > Providers**.
3. Find **Google** and enable it.
4. Paste the **Client ID** and **Client Secret** you got from Google.
5. Save the changes.

## 3. Redirect URLs
1. In Supabase Dashboard, go to **Authentication > URL Configuration**.
2. Add `http://localhost:5173` to the **Redirect URLs** list.
3. Ensure the **Site URL** is also set to `http://localhost:5173`.

---

Once these steps are completed, you will be able to sign up and log in using the Google button on the login page!
