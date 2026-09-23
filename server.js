import http from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const files = {'/':'index.html','/index.html':'index.html','/style.css':'style.css','/app.js':'app.js','/data.js':'data.js','/Game_map_7.41.jpg':'Game_map_7.41.jpg'};
const types={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',jpg:'image/jpeg'};
http.createServer(async(req,res)=>{const name=files[new URL(req.url,'http://localhost').pathname];if(!name){res.writeHead(404);return res.end('Not found');}try{const path=fileURLToPath(new URL(name,import.meta.url));const info=await stat(path);res.writeHead(200,{'Content-Type':types[name.split('.').pop()],'Content-Length':info.size});createReadStream(path).pipe(res);}catch{res.writeHead(500);res.end('Unable to read file');}}).listen(4173,'127.0.0.1',()=>console.log('Power Wards: http://localhost:4173'));
