# Ephemeral Room Chat

4명 이하 소규모 실시간 채팅 MVP입니다.

## 기능

- 링크 기반 방 입장: `/r/<roomId>`
- 입장코드 + 닉네임으로 참여
- 방 최대 인원 4명 제한
- 텍스트 메시지 실시간 전송
- 이미지 붙여넣기(Ctrl/Cmd+V) 또는 파일 선택 전송
- 모든 인원이 퇴장하면 방/대화 내용 즉시 삭제(메모리 기반)

## 실행

```bash
npm install
npm start
```

기본 접속: `http://localhost:3000`

## 배포 환경변수

- `CLIENT_ORIGIN` (선택): Socket.IO CORS 허용 도메인 목록
- 여러 개를 허용하려면 쉼표로 구분

예시:

```bash
CLIENT_ORIGIN=https://your-app.onrender.com,https://www.your-domain.com npm start
```

## 주의

- DB를 사용하지 않으므로 서버 재시작 시 모든 방/대화가 사라집니다.
- 이미지 최대 크기는 2MB입니다.
- 프로덕션에서는 HTTPS + 도메인 + 기본 보안 설정(CORS/Rate Limit 등)을 추가하세요.
