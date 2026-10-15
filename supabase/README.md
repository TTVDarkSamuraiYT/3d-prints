# Supabase setup

1. Create a Supabase project. In Authentication, enable email/password and disable public sign-ups.
2. Invite family accounts from Authentication → Users.
3. Run `migrations/202610150001_remote_print_queue.sql` in SQL Editor.
4. Make your account an admin using the commented SQL at the end of the migration; insert invited family as role `member` in `public.family_members`.
5. Put the project URL and anon/publishable key in `queue/app.js`. Never put the service-role key in browser code.
6. The private `print-files` bucket is limited to 100 MB per file in this starter.

The migration is for a new queue schema; review it before applying to an existing project. Invite-only authentication plus RLS protects library and queue data. Jobs remain records until a trusted home bridge and verified printer adapter are implemented.