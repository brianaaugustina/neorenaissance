import { MobileTabBar } from './MobileTabBar';
import { supabaseAdmin } from '@/lib/supabase/client';

// Server wrapper — counts pending queue items so the bottom-bar badge on
// mobile reflects live state. Non-fatal if Supabase is unreachable.
export async function MobileTabBarMount() {
  let queueCount = 0;
  try {
    const { count } = await supabaseAdmin()
      .from('approval_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    queueCount = count ?? 0;
  } catch {
    // graceful: badge just hides when count is 0
  }
  return <MobileTabBar queueCount={queueCount} />;
}
