// Receptor SMTP só para uso LOCAL: recebe o e-mail de login (link mágico) e
// grava o link em .dev-login-link.txt, sem mandar nada para fora.
// Em produção use EMAIL_SERVER (Gmail/SMTP próprio) ou RESEND_API_KEY.
//
//   node scripts/dev-mail-sink.mjs        (escuta 127.0.0.1:2525)
//   EMAIL_SERVER=smtp://127.0.0.1:2525    (no .env local)
import net from "node:net";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PORT = Number(process.env.DEV_MAIL_PORT ?? 2525);
const OUT = resolve(process.cwd(), ".dev-login-link.txt");

function decodeQuotedPrintable(text) {
  return text
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

const server = net.createServer((socket) => {
  let inData = false;
  let buffer = "";
  let message = "";
  socket.write("220 dev-mail-sink\r\n");
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    if (inData) {
      const end = buffer.indexOf("\r\n.\r\n");
      if (end === -1) return;
      message = buffer.slice(0, end);
      buffer = buffer.slice(end + 5);
      inData = false;
      const body = decodeQuotedPrintable(message);
      const link = body.match(/https?:\/\/[^\s"'<>]+\/api\/auth\/callback\/[^\s"'<>]+/)?.[0];
      if (link) {
        const clean = link.replace(/&amp;/g, "&");
        writeFileSync(OUT, clean + "\n");
        console.log(`[dev-mail] link de login gravado em ${OUT}`);
      } else {
        console.log("[dev-mail] e-mail recebido sem link de login");
      }
      socket.write("250 OK\r\n");
    }
    let idx;
    while (!inData && (idx = buffer.indexOf("\r\n")) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === "EHLO" || cmd === "HELO") socket.write("250 dev-mail-sink\r\n");
      else if (cmd === "MAIL" || cmd === "RCPT" || cmd === "RSET" || cmd === "NOOP") socket.write("250 OK\r\n");
      else if (cmd === "DATA") {
        inData = true;
        socket.write("354 End with <CRLF>.<CRLF>\r\n");
      } else if (cmd === "QUIT") {
        socket.end("221 Bye\r\n");
      } else socket.write("502 Not implemented\r\n");
    }
  });
  socket.on("error", () => {});
});

server.listen(PORT, "127.0.0.1", () =>
  console.log(`[dev-mail] escutando em 127.0.0.1:${PORT}`)
);
