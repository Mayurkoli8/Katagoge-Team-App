import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  // Render an inline message so first-time deployers know what's wrong.
  document.body.innerHTML = `
    <div style="padding:48px;font-family:monospace;color:#A8321B;background:#F4F2E9;min-height:100vh;">
      <h2>Configuration error</h2>
      <p>VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing.</p>
      <p>Set them in <code>.env.local</code> for local dev, or in your Cloudflare Pages
         project's environment variables for production.</p>
    </div>`;
  throw new Error('Missing Supabase env vars');
}

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
