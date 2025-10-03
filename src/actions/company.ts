import { supabase } from './lib/supabase';

export async function createCompany(name: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: company, error: cErr } = await supabase
    .from('companies')
    .insert([{ name }])
    .select()
    .single();
  if (cErr) throw cErr;

  const { error: mErr } = await supabase.from('memberships').insert([{
    user_id: user.id, company_id: company.id, role: 'owner'
  }]);
  if (mErr) throw mErr;

  return company.id;
}
