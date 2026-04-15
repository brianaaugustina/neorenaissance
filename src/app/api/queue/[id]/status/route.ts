import { NextResponse } from 'next/server';
import { updateQueueStatus, type QueueStatus } from '@/lib/supabase/client';

const ALLOWED: QueueStatus[] = ['approved', 'rejected', 'deferred', 'executed'];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const status = body?.status as QueueStatus | undefined;
    const feedback = body?.feedback as string | undefined;
    if (!status || !ALLOWED.includes(status)) {
      return NextResponse.json(
        { error: `status must be one of ${ALLOWED.join(', ')}` },
        { status: 400 },
      );
    }
    await updateQueueStatus(id, status, feedback);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}
