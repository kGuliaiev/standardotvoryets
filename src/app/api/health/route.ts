import { db } from '@/server/db';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ status: 'error' }, { status: 503 });
  }
}
