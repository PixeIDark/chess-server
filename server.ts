// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

const users = new Map();

const generateNickname = () => {
  const adjectives = ["빠른", "영리한", "대담한", "강한", "똑똑한", "용감한"];
  const animals = ["독수리", "호랑이", "사자", "여우", "늑대", "곰"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const animal = animals[Math.floor(Math.random() * animals.length)];
  const num = Math.floor(Math.random() * 1000);
  return `${adj}${animal}${num}`;
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

  io.emit("userConnected", {
    nickname,
    totalUsers: users.size,
  });

  socket.emit("nickameReceived", nickname);

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

    io.emit("lobbyMessage", chatData);
  });

  socket.on("disconnect", () => {
    const user = users.get(socket.id);
    console.log(`${user?.nickname} 연결 해제`);
    users.delete(socket.id);

    io.emit("userDisconnected", {
      totalUsers: users.size,
    });
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/", (req, res) => {
  res.json({ message: "Chess Server is running" });
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`서버 실행 중: ${PORT}`);
});