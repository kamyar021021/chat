import { NextResponse } from 'next/server';

export async function POST() {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3000';
  
  try {
    const res = await fetch(`${backendUrl}/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (!res.ok) {
      throw new Error('Backend returned an error');
    }
    
    const room = await res.json();
    return NextResponse.json({ roomId: room.id, expiresAt: room.expiresAt });
  } catch (error) {
    console.error('Error creating room:', error);
    return NextResponse.json({ error: 'Failed to create room' }, { status: 500 });
  }
}