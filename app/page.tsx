'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import * as nacl from 'tweetnacl';
import * as util from 'tweetnacl-util';

const SERVER_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:10000';

function ChatApp() {
  const searchParams = useSearchParams();
  
  const [roomId, setRoomId] = useState<string>('');
  const [inputRoomId, setInputRoomId] = useState<string>('');
  const [status, setStatus] = useState<string>('DISCONNECTED');
  const [messages, setMessages] = useState<string[]>([]);
  const [input, setInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [mySide, setMySide] = useState<'A' | 'B' | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const keyPairRef = useRef<nacl.BoxKeyPair | null>(null);
  const sharedKeyRef = useRef<Uint8Array | null>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  // این Ref برای جلوگیری از اتصال دوباره در React Strict Mode است
  const hasJoinedViaLink = useRef(false);

  // هندل کردن لینک دعوت (اگر کاربر با لینک وارد شده باشد)
  useEffect(() => {
    const roomParam = searchParams.get('room');
    
    // اگر لینک وجود داشت و قبلاً وصل نشده بودیم
    if (roomParam && !hasJoinedViaLink.current && status === 'DISCONNECTED') {
      hasJoinedViaLink.current = true; 
      setInputRoomId(roomParam);
      setRoomId(roomParam);
      setMySide('B');
      connectToRoom(roomParam, 'B');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (sharedKeyRef.current && inputRef.current) {
      inputRef.current.focus();
    }
  }, [messages]);

  const addMessage = (msg: string) => {
    setMessages((prev) => [...prev, msg]);
  };

  const createRoom = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/create-room', { method: 'POST' });
      const data = await res.json();
      if (data.roomId) {
        setRoomId(data.roomId);
        setMySide('A');
        connectToRoom(data.roomId, 'A');
      } else {
        addMessage('SYSTEM ERROR: Failed to create room.');
      }
    } catch (err) {
      addMessage('SYSTEM ERROR: Failed to create room.');
    } finally {
      setIsLoading(false);
    }
  };

  const joinRoom = () => {
    if (!inputRoomId) return;
    setRoomId(inputRoomId);
    setMySide('B');
    connectToRoom(inputRoomId, 'B');
  };

  const connectToRoom = (id: string, side: 'A' | 'B') => {
    
    // تولید کلیدهای جدید فقط برای همین اتصال
    keyPairRef.current = nacl.box.keyPair();
    sharedKeyRef.current = null;

    const socket = io(`${SERVER_URL}/chat`, {
      transports: ['websocket'],
      reconnection: false,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setStatus('CONNECTED');
      socket.emit('join-room', { roomId: id, side });
    });

    // هندل کردن خطای پر بودن اتاق
    socket.on('error-message', (msg: string) => {
      if (msg === 'ROOM_IS_FULL') {
        addMessage('🚨 ERROR: ROOM IS FULL. ONLY 2 USERS ALLOWED.');
        setStatus('DISCONNECTED');
        setRoomId('');
        socket.disconnect();
      }
    });

    socket.on('joined', () => {
      socket.emit('exchange-public-key', {
        roomId: id,
        side,
        publicKey: util.encodeBase64(keyPairRef.current!.publicKey),
      });
    });

    socket.on('peer-public-key', (data: { publicKey: string }) => {
      const peerPublicKey = util.decodeBase64(data.publicKey);
      sharedKeyRef.current = nacl.box.before(peerPublicKey, keyPairRef.current!.secretKey);
      setTimeout(() => inputRef.current?.focus(), 100);
    });

    socket.on('ciphertext', (data: { payload: string }) => {
      if (!sharedKeyRef.current) return;
      try {
        const { nonce, ciphertext } = JSON.parse(data.payload);
        const decrypted = nacl.box.open.after(
          util.decodeBase64(ciphertext),
          util.decodeBase64(nonce),
          sharedKeyRef.current
        );
        if (decrypted) {
          addMessage(`PEER: ${util.encodeUTF8(decrypted)}`);
        } else {
          addMessage('⚠️ WARNING: Failed to decrypt message (tampered).');
        }
      } catch (e) {
        addMessage('⚠️ ERROR: Invalid message format.');
      }
    });

    socket.on('room-destroyed', () => {
      addMessage('🚨 ROOM DESTROYED. CONNECTION CLOSED.');
      setStatus('DISCONNECTED');
      socket.disconnect();
    });

    socket.on('connect_error', () => {
      addMessage('🚨 CONNECTION ERROR. Server might be down.');
      setStatus('DISCONNECTED');
    });
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !socketRef.current || !sharedKeyRef.current) return;

    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const encrypted = nacl.box.after(util.decodeUTF8(input), nonce, sharedKeyRef.current);
    const payload = JSON.stringify({
      nonce: util.encodeBase64(nonce),
      ciphertext: util.encodeBase64(encrypted),
    });

    socketRef.current.emit('ciphertext', { roomId, payload });
    addMessage(`YOU: ${input}`);
    setInput('');
  };

  // ساخت لینک اختصاصی برای دعوت
  const inviteLink = typeof window !== 'undefined' ? `${window.location.origin}/?room=${roomId}` : '';

  const copyToClipboard = () => {
    navigator.clipboard.writeText(inviteLink);
    addMessage('SYSTEM: Invite link copied to clipboard!');
  };

  return (
    <div className="bg-[#0a0a0a] text-[#00ff00] h-[100dvh] w-full font-mono flex flex-col overflow-hidden">
      
      <div className="p-4 border-b border-[#00ff00] shrink-0">
        <h1 className="text-sm md:text-lg font-bold truncate">ROOT@SECURE_CHAT:~#</h1>
      </div>
      
      {status === 'DISCONNECTED' && !roomId && (
        <div className="p-4 flex-1 flex flex-col gap-4 overflow-y-auto">
          <p className="text-xs md:text-base">[ SYSTEM READY ] Please initialize a secure connection.</p>
          
          <div className="flex flex-col md:flex-row gap-3 w-full max-w-2xl">
            <button 
              onClick={createRoom} 
              disabled={isLoading}
              className={`border border-[#00ff00] p-2 bg-black transition-colors text-xs md:text-sm whitespace-nowrap
                ${isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[#00ff00] hover:text-black'}`}
            >
              {isLoading ? '[ CREATING... ]' : '[ CREATE NEW ROOM ]'}
            </button>
          </div>
        </div>
      )}

      {roomId && (
        <div className="flex-1 flex flex-col m-2 md:m-4 border border-[#00ff00] overflow-hidden relative">
          
          <div className="p-2 text-xs text-[#888] border-b border-[#00ff00] bg-black/50 shrink-0 flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
            <span>STATUS: {status}</span>
            
            {/* نمایش لینک دعوت فقط برای کاربر A (سازنده اتاق) */}
            {mySide === 'A' && (
              <button 
                onClick={copyToClipboard}
                className="text-[#00ff00] border border-[#00ff00] px-2 py-1 hover:bg-[#00ff00] hover:text-black transition-colors"
              >
                [ COPY INVITE LINK ]
              </button>
            )}
          </div>
          
          <div className="flex-1 overflow-y-auto p-2 space-y-2 text-xs md:text-sm break-words whitespace-pre-wrap">
            {messages.map((msg, i) => (
              <div key={i} className="leading-relaxed">{msg}</div>
            ))}
            <div ref={terminalEndRef} />
          </div>

          <form onSubmit={sendMessage} className="flex p-2 border-t border-[#00ff00] bg-black shrink-0 items-center gap-2">
            <span className="text-xs md:text-sm">$</span>
            <input 
              ref={inputRef}
              type="text" 
              value={input} 
              onChange={(e) => setInput(e.target.value)}
              className="bg-transparent border-none text-[#00ff00] outline-none flex-1 font-mono text-xs md:text-sm"
              placeholder={sharedKeyRef.current ? "Type your message..." : "Waiting for peer..."}
              disabled={!sharedKeyRef.current}
              autoComplete="off"
              spellCheck="false"
            />
          </form>
        </div>
      )}
    </div>
  );
}

// کامپوننت اصلی که در Suspense پیچیده شده (برای سازگاری با Vercel)
export default function Home() {
  return (
    <Suspense fallback={<div className="bg-[#0a0a0a] text-[#00ff00] h-[100dvh] flex items-center justify-center font-mono">Loading terminal...</div>}>
      <ChatApp />
    </Suspense>
  );
}
