/* =========================================================
   LEDGER STUDIO — Supabase configuration
   Replace the two values below with your own project's
   URL and anon key (Project Settings → API in Supabase).
   See SUPABASE_SETUP.md for the full setup guide.
========================================================= */

const SUPABASE_URL = "https://bxegrdarypalmcpoftxf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Nzxw-dAc_S9otrNboi2_7A_7vgPs3Wm";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);