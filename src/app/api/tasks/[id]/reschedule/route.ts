import { NextResponse } from 'next/server';
import { updateTask } from '@/lib/notion/client';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const toDoDate = body?.toDoDate;
    if (!toDoDate || typeof toDoDate !== 'string') {
      return NextResponse.json({ error: 'toDoDate required (YYYY-MM-DD)' }, { status: 400 });
    }
    await updateTask(id, { toDoDate });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}
