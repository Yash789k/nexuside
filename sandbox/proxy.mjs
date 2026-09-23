import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns/promises';
const domains=new Set((process.env.NEXUS_DOMAINS??'').split(',').filter(Boolean));
export function isPublic(ip){
  if(net.isIP(ip)!==4)return false;
  const [a,b]=ip.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19)||a===192&&b===2);
}
export async function resolveAllowed(host){if(!domains.has(host.toLowerCase())||net.isIP(host))throw new Error('Domain denied');const addresses=(await dns.lookup(host,{all:true})).filter(a=>a.family===4);if(!addresses.length||addresses.some(a=>!isPublic(a.address)))throw new Error('Private or unsupported destination denied');return addresses[0].address;}
const server=http.createServer((_req,res)=>{res.writeHead(403);res.end('Only allowlisted HTTPS CONNECT is supported');});
server.on('connect',async(req,client,head)=>{try{const u=new URL(`https://${req.url}`);if(u.port&&u.port!=='443'||u.username||u.password)throw new Error('Denied port');const ip=await resolveAllowed(u.hostname);const upstream=net.connect({host:ip,port:443});upstream.setTimeout(30_000,()=>upstream.destroy());upstream.on('connect',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);upstream.pipe(client);client.pipe(upstream);});upstream.on('error',()=>client.destroy());client.on('error',()=>upstream.destroy());client.on('close',()=>upstream.destroy());}catch{client.end('HTTP/1.1 403 Forbidden\r\n\r\n');}});
server.listen(3128,'0.0.0.0');
