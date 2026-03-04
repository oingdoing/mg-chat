const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const MAX_ROOM_SIZE = 4;
const MAX_HISTORY = 80;
const MAX_TEXT_LENGTH = 500;
const MAX_NICKNAME_LENGTH = 20;
const MAX_CODE_LENGTH = 20;
const MIN_CODE_LENGTH = 2;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = express();
const server = http.createServer(app);
const io = new Server(
  server,
  CLIENT_ORIGINS.length > 0
    ? {
        cors: {
          origin: CLIENT_ORIGINS
        }
      }
    : {}
);

const rooms = new Map();

function isValidRoomId(roomId) {
  return /^[A-Za-z0-9_-]{3,40}$/.test(roomId);
}

function cleanString(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function appendMessage(room, message) {
  room.messages.push(message);
  if (room.messages.length > MAX_HISTORY) {
    room.messages.splice(0, room.messages.length - MAX_HISTORY);
  }
}

function systemMessage(text) {
  return {
    id: createId('sys'),
    type: 'system',
    text,
    createdAt: nowIso()
  };
}

function listUsers(room) {
  return Array.from(room.users.values()).map((u) => u.nickname);
}

function parseDataUrl(dataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) {
    return { ok: false, reason: '이미지 형식이 올바르지 않습니다.' };
  }

  const mime = match[1].toLowerCase();
  if (!ALLOWED_IMAGE_MIME.has(mime)) {
    return { ok: false, reason: '지원하지 않는 이미지 형식입니다.' };
  }

  const base64 = match[2];
  let bytes;
  try {
    bytes = Buffer.byteLength(base64, 'base64');
  } catch (_err) {
    return { ok: false, reason: '이미지 인코딩을 읽을 수 없습니다.' };
  }

  if (bytes > MAX_IMAGE_BYTES) {
    return { ok: false, reason: `이미지는 ${Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))}MB 이하만 전송할 수 있습니다.` };
  }

  return {
    ok: true,
    mime
  };
}

function getRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) {
    return null;
  }
  const room = rooms.get(roomId);
  if (!room) {
    return null;
  }
  return { roomId, room };
}

function removeUser(socket) {
  const state = getRoom(socket);
  if (!state) {
    return;
  }

  const { roomId, room } = state;
  const user = room.users.get(socket.id);
  if (!user) {
    return;
  }

  room.users.delete(socket.id);

  if (room.users.size === 0) {
    rooms.delete(roomId);
    return;
  }

  const left = systemMessage(`${user.nickname}님이 퇴장했습니다.`);
  appendMessage(room, left);
  io.to(roomId).emit('new-message', left);
  io.to(roomId).emit('users-updated', listUsers(room));
}

io.on('connection', (socket) => {
  socket.on('join-room', (payload, ack = () => {}) => {
    const roomId = cleanString(payload?.roomId);
    const nickname = cleanString(payload?.nickname);
    const code = cleanString(payload?.code);

    if (!isValidRoomId(roomId)) {
      ack({ ok: false, error: '유효한 방 링크가 아닙니다.' });
      return;
    }

    if (!nickname || nickname.length > MAX_NICKNAME_LENGTH) {
      ack({ ok: false, error: `닉네임은 1~${MAX_NICKNAME_LENGTH}자로 입력해주세요.` });
      return;
    }

    if (code.length < MIN_CODE_LENGTH || code.length > MAX_CODE_LENGTH) {
      ack({ ok: false, error: `입장코드는 ${MIN_CODE_LENGTH}~${MAX_CODE_LENGTH}자로 입력해주세요.` });
      return;
    }

    let room = rooms.get(roomId);
    if (!room) {
      room = {
        code,
        users: new Map(),
        messages: []
      };
      rooms.set(roomId, room);
    } else {
      if (room.code !== code) {
        ack({ ok: false, error: '입장코드가 올바르지 않습니다.' });
        return;
      }
      if (room.users.size >= MAX_ROOM_SIZE) {
        ack({ ok: false, error: `이 방은 최대 ${MAX_ROOM_SIZE}명까지만 참여할 수 있습니다.` });
        return;
      }
    }

    const nicknameTaken = Array.from(room.users.values()).some(
      (u) => u.nickname.toLowerCase() === nickname.toLowerCase()
    );
    if (nicknameTaken) {
      ack({ ok: false, error: '이미 사용 중인 닉네임입니다.' });
      return;
    }

    const userId = createId('usr');
    room.users.set(socket.id, { nickname, userId });
    socket.data.roomId = roomId;
    socket.data.nickname = nickname;
    socket.data.userId = userId;
    socket.join(roomId);

    ack({
      ok: true,
      userId,
      users: listUsers(room),
      history: room.messages,
      limits: {
        maxRoomSize: MAX_ROOM_SIZE,
        maxImageMB: Math.floor(MAX_IMAGE_BYTES / (1024 * 1024)),
        maxTextLength: MAX_TEXT_LENGTH
      }
    });

    const joined = systemMessage(`${nickname}님이 입장했습니다.`);
    appendMessage(room, joined);
    io.to(roomId).emit('new-message', joined);
    io.to(roomId).emit('users-updated', listUsers(room));
  });

  socket.on('send-text', (payload, ack = () => {}) => {
    const state = getRoom(socket);
    if (!state) {
      ack({ ok: false, error: '먼저 방에 입장해주세요.' });
      return;
    }

    const text = cleanString(payload?.text);
    if (!text) {
      ack({ ok: false, error: '메시지가 비어 있습니다.' });
      return;
    }

    if (text.length > MAX_TEXT_LENGTH) {
      ack({ ok: false, error: `메시지는 ${MAX_TEXT_LENGTH}자 이하만 가능합니다.` });
      return;
    }

    const message = {
      id: createId('msg'),
      type: 'text',
      userId: socket.data.userId,
      nickname: socket.data.nickname,
      text,
      createdAt: nowIso()
    };

    appendMessage(state.room, message);
    io.to(state.roomId).emit('new-message', message);
    ack({ ok: true });
  });

  socket.on('send-image', (payload, ack = () => {}) => {
    const state = getRoom(socket);
    if (!state) {
      ack({ ok: false, error: '먼저 방에 입장해주세요.' });
      return;
    }

    const dataUrl = cleanString(payload?.dataUrl);
    if (!dataUrl) {
      ack({ ok: false, error: '이미지 데이터가 비어 있습니다.' });
      return;
    }

    const parsed = parseDataUrl(dataUrl);
    if (!parsed.ok) {
      ack({ ok: false, error: parsed.reason });
      return;
    }

    const message = {
      id: createId('img'),
      type: 'image',
      userId: socket.data.userId,
      nickname: socket.data.nickname,
      image: {
        mime: parsed.mime,
        dataUrl
      },
      createdAt: nowIso()
    };

    appendMessage(state.room, message);
    io.to(state.roomId).emit('new-message', message);
    ack({ ok: true });
  });

  socket.on('leave-room', () => {
    removeUser(socket);
    socket.leave(socket.data.roomId || '');
    socket.data.roomId = null;
    socket.data.nickname = null;
    socket.data.userId = null;
  });

  socket.on('disconnect', () => {
    removeUser(socket);
  });
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/r/:roomId', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Chat server running on http://localhost:${PORT}`);
});
