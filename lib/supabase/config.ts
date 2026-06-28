// Public Supabase connection values.
//
// The Project URL and the `anon` public key are designed to be shipped to the
// browser — they are not secrets. Data access is governed by Postgres
// Row-Level Security, not by hiding these values.
//
// These are HARD-WIRED (not read from environment variables) so that no stray
// hosting-dashboard setting can ever point the app at the wrong Supabase
// project. This deployment always talks to the `oeexkoeeszfsihdgdsms` project.
export const SUPABASE_URL = "https://oeexkoeeszfsihdgdsms.supabase.co";

export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9lZXhrb2Vlc3pmc2loZGdkc21zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NjY0OTIsImV4cCI6MjA5ODI0MjQ5Mn0.Q1839OEmW6jSe1IXFcbh6Fcc_HXr8bmW9f5r26EZKDw";
