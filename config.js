// Lim inn verdier fra Supabase → Project Settings → API. Anon-nøkkelen er laget for å ligge i frontend;
// dataene er beskyttet av tilgangsreglene (RLS) i supabase/schema.sql.
export const SUPABASE_URL = 'https://gtsyrgnzhjpxvmzkbmlj.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_cqlbztXgLGMnKBctul-rrg_XLe3vpeO';
// Offentlig VAPID-nøkkel for push-varsler (se SETUP.md, steg 7). Den hemmelige nøkkelen skal ALDRI hit.
export const VAPID_PUBLIC_KEY = 'DIN-VAPID-PUBLIC-KEY';
