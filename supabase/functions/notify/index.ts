// Sender push-varsler (budsjett, sesongutgifter, poster som venter på sortering).
// Kalles av appen etter import (med brukerens innlogging) og daglig av Supabase Cron (med x-cron-secret).
import { createClient } from 'npm:@supabase/supabase-js@2.75.0';
import webpush from 'npm:web-push@3.6.7';
// _shared/ er en kopi av ../../lib – opprettes av `npm run deploy:fn`
import { planNotifications } from '../_shared/notify.js';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const num = (rows: any[]) => rows.map(r => ({ ...r, amount: Number(r.amount), share: r.share == null ? 1 : Number(r.share) }));

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

  // Hvem kaller? Cron → alle husholdninger. Innlogget bruker → kun egen.
  let householdIds: string[];
  const cron = req.headers.get('x-cron-secret');
  if (cron && cron === Deno.env.get('CRON_SECRET')) {
    householdIds = (await db.from('households').select('id')).data!.map(h => h.id);
  } else {
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /i, '');
    const { data: { user } } = await db.auth.getUser(token);
    if (!user) return json({ error: 'unauthorized' }, 401);
    householdIds = ((await db.from('members').select('household_id').eq('user_id', user.id)).data ?? []).map(m => m.household_id);
  }

  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 430 * 864e5).toISOString().slice(0, 10);
  let sentCount = 0;

  for (const hid of householdIds) {
    const txs: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await db.from('transactions').select('date,text,amount,category,kind,status,account_id,share').eq('household_id', hid).gte('date', since).range(from, from + 999);
      txs.push(...(data ?? [])); if (!data || data.length < 1000) break;
    }
    const [{ data: bu }, { data: manual }, { data: sent }, { data: mem }, { data: accounts }, { data: marks }] = await Promise.all([
      db.from('budgets').select('category,amount').eq('household_id', hid),
      db.from('seasonal_items').select('*').eq('household_id', hid),
      db.from('alerts_sent').select('key').eq('household_id', hid),
      db.from('members').select('user_id').eq('household_id', hid),
      db.from('accounts').select('id,name,remind').eq('household_id', hid), db.from('upload_marks').select('account_id,month').eq('household_id', hid)]);
    const budgets = Object.fromEntries((bu ?? []).map(b => [b.category, Number(b.amount)]));
    const plan = planNotifications({ txs: num(txs), budgets, manual: manual ?? [], today, sent: new Set((sent ?? []).map(s => s.key)), accounts: accounts ?? [], marks: marks ?? [] });
    if (!plan.length) continue;

    const { data: subs } = await db.from('push_subscriptions').select('*').in('user_id', (mem ?? []).map(m => m.user_id));
    for (const n of plan) {
      // Marker som sendt først: unik nøkkel gjør at to samtidige kall ikke sender dobbelt
      const { error } = await db.from('alerts_sent').insert({ household_id: hid, key: n.key });
      if (error) continue;
      for (const s of subs ?? []) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title: n.title, body: n.body, tag: n.key }));
          sentCount++;
        } catch (e: any) {
          if (e.statusCode === 404 || e.statusCode === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint); // enheten har meldt seg av
          else console.error('push feilet', e.statusCode, e.body);
        }
      }
    }
  }
  return json({ ok: true, sent: sentCount });
});
