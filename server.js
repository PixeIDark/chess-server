import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

const users = new Map();
const gameRooms = new Map();

// 랜덤 닉네임 생성
const generateNickname = () => {
  const adjectives = ["빠른", "영리한", "대담한", "강한", "똑똑한", "용감한"];
  const animals = ["독수리", "호랑이", "사자", "여우", "늑대", "곰"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const animal = animals[Math.floor(Math.random() * animals.length)];
  const num = Math.floor(Math.random() * 1000);
  return `${adj}${animal}${num}`;
};

// 게임룸 ID 생성
const generateRoomId = () => {
  return `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

io.on("connection", (socket) => {
  const nickname = generateNickname();
  const user = {
    socketId: socket.id,
    nickname,
    lastMessageTime: Date.now(),
  };

  users.set(socket.id, user);

  console.log(`${nickname} 연결됨 (${socket.id})`);

  // 새 유저 브로드캐스트
  io.emit("userConnected", {
    nickname,
    totalUsers: users.size,
  });

  // 닉네임 전송
  socket.emit("nickameReceived", nickname);

  // 전체 채팅 메시지
  socket.on("lobbyMessage", (message) => {
    const user = users.get(socket.id);
    if (!user) return;

    const timestamp = Date.now();
    user.lastMessageTime = timestamp;

    const chatData = {
      nickname: user.nickname,
      message,
      timestamp,
      socketId: socket.id,
    };

    // 모든 클라이언트에게 브로드캐스트
    io.emit("lobbyMessage", chatData);
  });

  // 1:1 대결 신청
  socket.on("challengeRequest", (targetSocketId) => {
    const challenger = users.get(socket.id);
    const target = users.get(targetSocketId);

    if (!challenger || !target) {
      socket.emit("challengeError", "상대방을 찾을 수 없습니다.");
      return;
    }

    // 600초 조건 확인
    const timeDiff = Date.now() - target.lastMessageTime;
    if (timeDiff > 600000) {
      socket.emit("challengeError", "상대방과 600초 이내의 채팅 기록이 없습니다.");
      return;
    }

    // 게임룸 생성
    const roomId = generateRoomId();
    const gameRoom = {
      roomId,
      player1: challenger,
      player2: target,
      createdAt: Date.now(),
    };

    gameRooms.set(roomId, gameRoom);

    // 두 플레이어를 게임룸에 조인
    socket.join(roomId);
    io.sockets.sockets.get(targetSocketId)?.join(roomId);

    // 게임 시작 알림
    io.to(roomId).emit("gameStarted", {
      roomId,
      player1: challenger.nickname,
      player2: target.nickname,
      player1SocketId: challenger.socketId,
      player2SocketId: target.socketId,
    });

    console.log(`게임 시작: ${challenger.nickname} vs ${target.nickname} (${roomId})`);
  });

  // 게임 중 움직임
  socket.on("gameMove", (data) => {
    const { roomId, move } = data;
    socket.to(roomId).emit("gameMove", move);
  });

  // 게임 중 채팅
  socket.on("gameMessage", (data) => {
    const { roomId, message } = data;
    const user = users.get(socket.id);
    if (!user) return;

    const chatData = {
      nickname: user.nickname,
      message,
      timestamp: Date.now(),
    };

    io.to(roomId).emit("gameMessage", chatData);
  });

  // 게임 종료
  socket.on("gameEnd", (data) => {
    const { roomId } = data;
    io.to(roomId).emit("gameEnded", data);
  });

  // 게임 도중 나감 (상대 즉시 승리)
  socket.on("gameQuit", (roomId) => {
    const gameRoom = gameRooms.get(roomId);
    if (!gameRoom) return;

    const loser = users.get(socket.id);
    const winner =
      loser?.socketId === gameRoom.player1.socketId
        ? gameRoom.player2
        : gameRoom.player1;

    io.to(roomId).emit("opponentQuit", {
      winner: winner.nickname,
      loser: loser?.nickname,
    });

    gameRooms.delete(roomId);
  });

  // 게임 후 대기
  socket.on("waitInGame", (roomId) => {
    console.log(`${users.get(socket.id)?.nickname}가 게임룸에서 대기 중`);
  });

  // 게임룸 나감 (전체 채팅으로 복귀)
  socket.on("leaveGameRoom", (roomId) => {
    const gameRoom = gameRooms.get(roomId);
    if (!gameRoom) return;

    socket.leave(roomId);

    // 상대방도 남았는지 확인
    const roomSockets = io.sockets.adapter.rooms.get(roomId);
    if (!roomSockets || roomSockets.size === 0) {
      gameRooms.delete(roomId);
      console.log(`게임룸 삭제: ${roomId}`);
    } else {
      // 상대방에게 알림
      io.to(roomId).emit("partnerLeft");
    }
  });

  // 연결 해제
  socket.on("disconnect", () => {
    const user = users.get(socket.id);
    console.log(`${user?.nickname} 연결 해제`);

    // 게임 중이었으면 상대방 승리 처리
    for (const [roomId, gameRoom] of gameRooms) {
      if (
        gameRoom.player1.socketId === socket.id ||
        gameRoom.player2.socketId === socket.id
      ) {
        const winner =
          gameRoom.player1.socketId === socket.id
            ? gameRoom.player2
            : gameRoom.player1;
        io.to(roomId).emit("opponentDisconnected", {
          winner: winner.nickname,
        });
        gameRooms.delete(roomId);
      }
    }

    users.delete(socket.id);

    io.emit("userDisconnected", {
      totalUsers: users.size,
    });
  });
});

// 헬스 체크 엔드포인트
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// 루트 경로 추가
app.get("/", (req, res) => {
  res.json({ message: "Ghost Chess King Server is running" });
});

server.listen(PORT, () => {
  console.log(`서버 실행 중: ${PORT}`);
});