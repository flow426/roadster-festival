const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

const rooms = new Map();
const MAX_PLAYERS = 10;

function code() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}
function cleanRoom(room) {
  if (room.players.size === 0) rooms.delete(room.code);
}
io.on("connection", socket => {
  socket.on("createRoom", ({name}, cb) => {
    let id = code();
    while (rooms.has(id)) id = code();
    const room = {code:id, players:new Map(), started:false};
    rooms.set(id, room);
    join(socket, room, name, cb);
  });
  socket.on("joinRoom", ({code:roomCode, name}, cb) => {
    const room = rooms.get(String(roomCode || "").toUpperCase());
    if (!room) return cb?.({ok:false, error:"방을 찾을 수 없습니다."});
    if (room.players.size >= MAX_PLAYERS) return cb?.({ok:false, error:"방이 가득 찼습니다. (최대 10명)"});
    join(socket, room, name, cb);
  });
  function join(sock, room, name, cb) {
    if (sock.data.room) return cb?.({ok:false,error:"이미 방에 참가했습니다."});
    const player = {
      id:sock.id, name:String(name || "플레이어").slice(0,12),
      x:0, z:0, rot:0, color:["#ff595e","#1982c4","#8ac926","#ffca3a","#6a4c93","#f9844a"][room.players.size%6],
      finished:false
    };
    room.players.set(sock.id, player);
    sock.data.room = room.code;
    sock.join(room.code);
    cb?.({ok:true, code:room.code, id:sock.id});
    io.to(room.code).emit("roomState", [...room.players.values()]);
  }
  socket.on("startRace", () => {
    const room = rooms.get(socket.data.room);
    if (!room || room.started) return;
    room.started = true;
    room.players.forEach(p => {p.x=0;p.z=0;p.finished=false;});
    io.to(room.code).emit("raceStarted");
  });
  socket.on("move", data => {
    const room = rooms.get(socket.data.room);
    const p = room?.players.get(socket.id);
    if (!p || !room.started || p.finished) return;
    p.x = Math.max(-7, Math.min(7, Number(data.x)||0));
    p.z = Math.max(-8, Math.min(150, Number(data.z)||0));
    p.rot = Number(data.rot)||0;
    if (p.z >= 145) p.finished = true;
    socket.to(room.code).emit("playerMoved", {id:p.id,x:p.x,z:p.z,rot:p.rot,finished:p.finished});
    if (p.finished) io.to(room.code).emit("playerFinished", {id:p.id,name:p.name});
    if ([...room.players.values()].every(x=>x.finished)) {
      room.started=false;
      io.to(room.code).emit("raceEnded");
    }
  });
  socket.on("disconnect", () => {
    const room = rooms.get(socket.data.room);
    if (!room) return;
    room.players.delete(socket.id);
    io.to(room.code).emit("roomState", [...room.players.values()]);
    cleanRoom(room);
  });
});
const port = process.env.PORT || 3000;
server.listen(port, () => console.log("Roadster Festival listening on " + port));
