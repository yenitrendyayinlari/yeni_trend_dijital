import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://gzkqylheloxcgpcrftci.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_zDB7lVQ00ickN7N-YxEXog__OHGX-Od';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
