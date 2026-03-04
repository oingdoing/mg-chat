const roomMatch = /^\/r\/([A-Za-z0-9_-]{3,40})$/.exec(window.location.pathname);
const roomIdFromPath = roomMatch ? roomMatch[1] : null;

const homeSection = document.getElementById('homeSection');
const chatSection = document.getElementById('chatSection');
const createRoomBtn = document.getElementById('createRoomBtn');
const goRoomForm = document.getElementById('goRoomForm');
const roomIdInput = document.getElementById('roomIdInput');

const roomTitle = document.getElementById('roomTitle');
const roomHint = document.getElementById('roomHint');
const roomInfoBlock = document.getElementById('roomInfoBlock');
const joinPanel = document.getElementById('joinPanel');
const joinForm = document.getElementById('joinForm');
const nicknameInput = document.getElementById('nicknameInput');
const codeInput = document.getElementById('codeInput');

const chatPanel = document.getElementById('chatPanel');
const userCount = document.getElementById('userCount');
const userList = document.getElementById('userList');
const messages = document.getElementById('messages');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const imageBtn = document.getElementById('imageBtn');
const imageInput = document.getElementById('imageInput');
const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
const leaveBtn = document.getElementById('leaveBtn');
const shareLink = document.getElementById('shareLink');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const toast = document.getElementById('toast');

const socket = io();
const SIDEBAR_PREF_KEY = 'ephemeral_chat_sidebar_collapsed';
const DEFAULT_LIMITS = {
  maxImageMB: 2,
  maxTextLength: 500
};
let joined = false;
let currentRoomId = roomIdFromPath;
let myUserId = '';
let sidebarCollapsed = false;
let roomLimits = { ...DEFAULT_LIMITS };

function showToast(text) {
  toast.textContent = text;
  toast.classList.remove('hidden');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.add('hidden');
  }, 2200);
}

function escapeRoomId(value) {
  return value.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
}

function randomRoomId() {
  return `room-${Math.random().toString(36).slice(2, 8)}`;
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (_err) {
    return '';
  }
}

function clearMessages() {
  while (messages.firstChild) {
    messages.removeChild(messages.firstChild);
  }
}

function appendMessage(message) {
  const li = document.createElement('li');
  li.className = `message ${message.type === 'system' ? 'system' : ''}`;
  if (message.type !== 'system' && myUserId && message.userId === myUserId) {
    li.classList.add('mine');
  }

  const header = document.createElement('div');
  header.className = 'messageHeader';

  const name = document.createElement('span');
  name.className = 'messageName';
  name.textContent = message.type === 'system' ? '안내' : message.nickname || '익명';

  const time = document.createElement('span');
  time.className = 'messageTime';
  time.textContent = formatTime(message.createdAt);

  header.appendChild(name);
  header.appendChild(time);
  li.appendChild(header);

  if (message.type === 'image' && message.image?.dataUrl) {
    const img = document.createElement('img');
    img.src = message.image.dataUrl;
    img.alt = '첨부 이미지';
    li.appendChild(img);
  } else {
    const text = document.createElement('div');
    text.textContent = message.text || '';
    li.appendChild(text);
  }

  messages.appendChild(li);
  messages.scrollTop = messages.scrollHeight;
}

function renderUsers(users) {
  userCount.textContent = String(users.length);
  userList.innerHTML = '';

  users.forEach((nickname) => {
    const li = document.createElement('li');
    li.textContent = nickname;
    userList.appendChild(li);
  });
}

function normalizeLimits(limits) {
  const maxImageMB =
    Number.isInteger(limits?.maxImageMB) && limits.maxImageMB > 0
      ? limits.maxImageMB
      : DEFAULT_LIMITS.maxImageMB;
  const maxTextLength =
    Number.isInteger(limits?.maxTextLength) && limits.maxTextLength > 0
      ? limits.maxTextLength
      : DEFAULT_LIMITS.maxTextLength;

  return { maxImageMB, maxTextLength };
}

function applyLimits(limits) {
  roomLimits = normalizeLimits(limits);
  messageInput.maxLength = String(roomLimits.maxTextLength);
}

function setSidebarCollapsed(collapsed, options = {}) {
  const { persist = true } = options;
  sidebarCollapsed = Boolean(collapsed);
  chatPanel.classList.toggle('sidebar-collapsed', sidebarCollapsed);
  roomInfoBlock.classList.toggle('hidden', sidebarCollapsed);
  toggleSidebarBtn.textContent = sidebarCollapsed ? '정보 펼치기' : '정보 접기';
  toggleSidebarBtn.setAttribute('aria-expanded', String(!sidebarCollapsed));

  if (!persist) {
    return;
  }

  try {
    window.localStorage.setItem(SIDEBAR_PREF_KEY, sidebarCollapsed ? '1' : '0');
  } catch (_err) {
    // Ignore storage failures.
  }
}

function showHome() {
  homeSection.classList.remove('hidden');
  chatSection.classList.add('hidden');
}

function showRoom() {
  homeSection.classList.add('hidden');
  chatSection.classList.remove('hidden');
  roomTitle.textContent = `채팅방: ${currentRoomId}`;
  roomHint.textContent = '최대 4명, 마지막 인원 퇴장 시 방과 대화가 즉시 삭제됩니다.';
  shareLink.value = window.location.href;
}

function setJoinedState(isJoined) {
  joined = isJoined;
  joinPanel.classList.toggle('hidden', isJoined);
  chatPanel.classList.toggle('hidden', !isJoined);
}

function moveToRoom(roomId) {
  const safeRoomId = escapeRoomId(roomId);
  if (safeRoomId.length < 3) {
    showToast('방 ID는 3자 이상이어야 합니다.');
    return;
  }
  window.location.href = `/r/${safeRoomId}`;
}

function joinRoom(event) {
  event.preventDefault();
  if (!currentRoomId) {
    return;
  }

  const nickname = nicknameInput.value.trim();
  const code = codeInput.value.trim();

  socket.emit('join-room', { roomId: currentRoomId, nickname, code }, (response) => {
    if (!response?.ok) {
      showToast(response?.error || '입장에 실패했습니다.');
      return;
    }

    myUserId = typeof response.userId === 'string' ? response.userId : '';
    applyLimits(response.limits);
    clearMessages();
    response.history.forEach(appendMessage);
    renderUsers(response.users || []);
    setJoinedState(true);
    messageInput.focus();
    showToast('채팅방에 입장했습니다.');
  });
}

function sendText(event) {
  event.preventDefault();
  if (!joined) {
    return;
  }

  const text = messageInput.value.trim();
  if (!text) {
    return;
  }
  if (text.length > roomLimits.maxTextLength) {
    showToast(`메시지는 ${roomLimits.maxTextLength}자 이하만 가능합니다.`);
    return;
  }

  socket.emit('send-text', { text }, (response) => {
    if (!response?.ok) {
      showToast(response?.error || '메시지 전송 실패');
      return;
    }
    messageInput.value = '';
    messageInput.focus();
  });
}

function sendImageFile(file) {
  if (!joined) {
    showToast('먼저 방에 입장해주세요.');
    return;
  }

  if (!file) {
    return;
  }

  if (!file.type.startsWith('image/')) {
    showToast('이미지 파일만 전송할 수 있습니다.');
    return;
  }

  const maxImageBytes = roomLimits.maxImageMB * 1024 * 1024;
  if (file.size > maxImageBytes) {
    showToast(`이미지는 ${roomLimits.maxImageMB}MB 이하만 전송할 수 있습니다.`);
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = typeof reader.result === 'string' ? reader.result : '';
    socket.emit('send-image', { dataUrl }, (response) => {
      if (!response?.ok) {
        showToast(response?.error || '이미지 전송 실패');
        return;
      }
      showToast('이미지를 전송했습니다.');
    });
  };
  reader.onerror = () => {
    showToast('이미지를 읽을 수 없습니다.');
  };
  reader.readAsDataURL(file);
}

function handlePaste(event) {
  const items = event.clipboardData?.items;
  if (!items) {
    return;
  }

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      event.preventDefault();
      const file = item.getAsFile();
      sendImageFile(file);
      return;
    }
  }
}

function handleMessageKeydown(event) {
  if (event.key !== 'Enter' || event.isComposing) {
    return;
  }

  // Alt+Enter keeps the default newline behavior.
  if (event.altKey) {
    return;
  }

  event.preventDefault();
  if (!joined) {
    return;
  }

  if (typeof messageForm.requestSubmit === 'function') {
    messageForm.requestSubmit();
    return;
  }

  messageForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

if (roomIdFromPath) {
  showRoom();
  setJoinedState(false);
} else {
  showHome();
}

try {
  sidebarCollapsed = window.localStorage.getItem(SIDEBAR_PREF_KEY) === '1';
} catch (_err) {
  sidebarCollapsed = false;
}
setSidebarCollapsed(sidebarCollapsed, { persist: false });
applyLimits(DEFAULT_LIMITS);

createRoomBtn.addEventListener('click', () => {
  moveToRoom(randomRoomId());
});

goRoomForm.addEventListener('submit', (event) => {
  event.preventDefault();
  moveToRoom(roomIdInput.value);
});

joinForm.addEventListener('submit', joinRoom);
messageForm.addEventListener('submit', sendText);
messageInput.addEventListener('paste', handlePaste);
messageInput.addEventListener('keydown', handleMessageKeydown);

imageBtn.addEventListener('click', () => {
  imageInput.click();
});

toggleSidebarBtn.addEventListener('click', () => {
  setSidebarCollapsed(!sidebarCollapsed);
});

imageInput.addEventListener('change', () => {
  if (imageInput.files && imageInput.files.length > 0) {
    sendImageFile(imageInput.files[0]);
  }
  imageInput.value = '';
});

copyLinkBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    showToast('링크를 복사했습니다.');
  } catch (_err) {
    showToast('클립보드 복사에 실패했습니다.');
  }
});

leaveBtn.addEventListener('click', () => {
  if (joined) {
    socket.emit('leave-room');
  }
  setJoinedState(false);
  applyLimits(DEFAULT_LIMITS);
  myUserId = '';
  clearMessages();
  renderUsers([]);
  showToast('채팅방에서 나왔습니다.');
});

socket.on('new-message', (message) => {
  if (!roomIdFromPath) {
    return;
  }
  appendMessage(message);
});

socket.on('users-updated', (users) => {
  renderUsers(users || []);
});

socket.on('disconnect', () => {
  if (joined) {
    showToast('서버와 연결이 끊겼습니다. 새로고침 후 다시 입장해주세요.');
    setJoinedState(false);
    applyLimits(DEFAULT_LIMITS);
    myUserId = '';
  }
});
